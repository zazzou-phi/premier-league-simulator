# Monte Carlo & picks

Implementation: `engine/src/simulation/monteCarlo.ts`, pick strategies in `engine/src/engine/pickStrategy.ts`, calibrated solve in `engine/src/engine/calibratedPicks.ts`, persistence via `Repository.savePredictionFromMonteCarlo`.

## Goals

Estimate season-level probabilities and representative scorelines without storing every simulated run. A naive World Cup-era approach (persist all run fixtures) grew the DB to ~1.6 GB; this app aggregates in memory instead.

## Batch parameters

| Parameter | Constraint |
|-----------|------------|
| `runs` | Integer `1…100_000` (`MONTE_CARLO_MAX_RUNS`) |
| `upsetVariance` | Optional override; else current settings |
| Season Elo weight | Taken from current settings and stored on the prediction |
| `reservoirSize` | Default `50` (`DEFAULT_RESERVOIR_SIZE`) |

Rough scale: ~1,000 seasons (~380,000 matches) in ~350 ms on typical hardware.

## Aggregation (in memory)

Each run:

1. `simulateSeason` with current locked results
2. Increment per-fixture home/draw/away counts and scoreline histogram
3. Record each team's finishing position
4. Accumulate points / GF / GA sums
5. Reservoir-sample the full season (Algorithm R) into a bounded set of complete seasons

**Never persist per-run fixture rows.** Persist only:

- Outcome distributions (bounded by fixture count)
- Scoreline histograms (bounded by observed scorelines × fixtures)
- Finishing-position histograms (20 positions × 20 teams)
- Team stat sums
- Reservoir seasons (~50 × 380 rows)

## Projections

Per team, derived from histograms / averages:

| Field | Meaning |
|-------|---------|
| `titleProbability` | Finish 1st |
| `championsLeagueProbability` | Finish 1–4 |
| `europeanProbability` | Finish 1–5 |
| `relegationProbability` | Finish in bottom 3 |
| Averages | Mean points, GF, GA, position |

## Pick strategies

A prediction collapses distributions into one representative `SeasonState`. The strategy is stored on the prediction (`pickStrategy`). Actual locked results always override picked scorelines.

| Strategy | Scope | Behaviour |
|----------|-------|-----------|
| `likeliestScore` | per fixture | Modal scoreline within each outcome, then the most frequent of those three candidates |
| `likeliestResult` | per fixture | Most frequent outcome, then its most frequent scoreline (ties: win beats draw; two wins prefer higher Elo) |
| `maxPoints` | per fixture | Of those same three candidates, the one maximising expected predictor-game points |
| `calibrated` (default) | season-wide | Assignment whose outcome counts match the simulation's own expectations |
| `random` | season-wide | Replay one whole season from the reservoir (`prediction_active_sample`) |

The two season-wide strategies are resolved by the caller and passed into `choosePick` per fixture
(`calibratedPick`, `savedSample`), so the per-fixture seam holds for all five.

`random` exists so the UI can show a **coherent** season rather than stitching independent per-fixture modal draws.

## Why the per-fixture strategies distort W/D/L

Every per-fixture rule picks the *mode* of a distribution, and the mode of a marginal is not a draw
from it. Measured over one 5,000-run batch on a full 380-fixture season, against the batch's own
expectation of 167 home / 85 draw / 128 away:

| Strategy | H | D | A |
|---|---|---|---|
| `likeliestScore` | 83 | **265** | 32 |
| `likeliestResult` | 243 | **0** | 137 |
| `maxPoints` (3/1) | 242 | **0** | 138 |
| `calibrated` | 167 | **85** | 128 |

Both failures come from the same place, in opposite directions. A draw is essentially never the
single likeliest outcome — 22% against ~44% home — so `likeliestResult` returns *zero* draws, not
merely few. Conversely draw mass concentrates on 1–1 and 0–0 while win mass spreads across 1–0,
2–0, 2–1, so the modal scoreline is a draw in about 70% of fixtures.

This is a property of the collapse, not of the match model: the model itself draws 22.6% of
fixtures against an observed 23.9% (see [match-model.md](match-model.md)).

## Calibrated picks

`engine/src/engine/calibratedPicks.ts`. Picks the whole season at once: the assignment maximising
total log-likelihood **subject to** the counts the simulation expects. Two sets of constraints:

- each team's own expected draws (`Σ P(draw)` over its 38 fixtures, ~8.5)
- the league's away-win total (which, with draws pinned, fixes the home/away split)

The constrained optimum is the Lagrangian dual: add a bias to each outcome's log-probability and
tune the biases until the counts land. One bias per team for draws, one shared for away wins, home
win as the untouched reference.

For a fixture between home team `h` and away team `a`, the three scores are:

```
s_home = log P(home)
s_draw = log P(draw) + β_h + β_a
s_away = log P(away) + γ
```

`β` is a per-team draw bias (20 of them), `γ` a single league-wide away bias. Home win carries no
bias and acts as the reference — adding a constant to all three leaves every `argmax` unchanged, so
one must be pinned or the parameterisation is over-determined. That leaves 21 free parameters
against 21 constraints: 20 per-team draw counts plus the away total.

Solved by coordinate descent, and each coordinate is solved *exactly* rather than by gradient
steps. Holding the others fixed, a team's draw count is a step function of its own bias, so
sorting that team's thresholds and taking the midpoint between the k-th and k+1-th lands exactly
k draws. Deterministic — no RNG, every sort total — around 100 sweeps and ~30 ms for 380 fixtures.

Fitted values on a 5,000-run batch: `γ = 0.223`, and `β` running from `0.270` (Leeds, expecting
8.97 draws) to `0.914` (Hull, expecting 6.46). The spread is small because every team's draw
expectation is similar; the weakest and strongest sides need the largest nudge because their
fixtures are the least even.

Locked fixtures are included in the solve. Their distributions are degenerate, so they pin
themselves and contribute their known result to the targets; that is what keeps a batch's picks
stable as results land.

The per-team constraint is what makes it usable. A league-wide draw quota alone concentrates draws
on the evenly matched fixtures, leaving the strongest and weakest sides on nearly none.

**A calibrated point estimate still gives every team 7–9 draws**, because every team's *expectation*
is ~8.5. The 7–14 spread across a real season is sampling noise, which only `random` reproduces.
The same caveat applies to points: any modal table is over-dispersed (Arsenal reads 100 against a
mean simulated 82), so `averagePoints` in the projections remains the honest central estimate.

## Expected-points picks

For a predictor game paying `exactScore` for a perfect scoreline and `correctResult` for a right
result with the wrong scoreline — the higher of the two, not both — a pick is worth:

```
correctResult · P(outcome) + (exactScore − correctResult) · P(scoreline)
```

Searching only the three modal-per-outcome candidates is exact, not an approximation: within one
outcome the `P(outcome)` term is constant, so the best pick there is that outcome's modal scoreline,
and a scoreline no run produced scores `P(scoreline) = 0`. Scored in raw run counts.

`likeliestScore` and `likeliestResult` are the degenerate ends of the same formula —
`correctResult = 0` gives one, `exactScore = correctResult` the other.

The payoff lives in `app_settings` (`exact_score_points`, `correct_result_points`, defaulting to
3/1) and is snapshotted onto each prediction like `upsetVariance`, so a stored pick can be traced
to the scoring rule it was optimising.

Draws arrive only once the exact-score premium is steep enough to be worth chasing, and the default
3/1 is not steep enough — measured on the same batch as above:

| `exactScore` (at `correctResult = 1`) | 3 | 4 | 5 | 6 | 8 | 10 | 15 |
|---|---|---|---|---|---|---|---|
| Draws picked | 0 | 2 | 10 | 37 | 85 | 118 | 164 |

So at its default this strategy behaves like `likeliestResult`, not like `likeliestScore`. Use
`calibrated` for a realistic season; `maxPoints` answers a different question — what to submit to a
predictor game under a given payoff.

## Active prediction

For export and default UI selection, the active prediction is the most recently `updatedAt` prediction (`getActivePrediction`).
