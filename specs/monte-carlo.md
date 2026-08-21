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

Once per batch, before any run:

- Split the fixture list into locked and unplayed. Only the unplayed remainder is simulated.
- Fold the locked results into a starting table (`accumulateTotals`), so each run seeds its
  standings from reality in O(1) instead of replaying those fixtures.
- Sort the remainder into play order (`orderFixtures`) — a property of the fixture list, not
  of a run.

Each run:

1. `simulateSeason` over the remainder
2. Increment per-fixture home/draw/away counts and scoreline histogram
3. Record each team's finishing position, from the seeded table
4. Accumulate points / GF / GA sums
5. Reservoir-sample the simulated season (Algorithm R) into a bounded set of seasons

Once per batch, after the loop, the locked fixtures are re-attached:

- as **degenerate distributions** (`total = runs`, all mass on the real scoreline)
- as entries in every sampled season, merged back in match-number order

So a persisted batch still describes all 380 fixtures and its stored shape is unchanged by the
remainder-only refactor. That matters downstream: the calibrated solve reads those degenerate
distributions to pin the locked fixtures and to compute its per-team draw targets, the
per-fixture distribution modal renders them as a 100% "recorded result" bar, and batches saved
before and after the change grade identically. The per-run cost now scales with fixtures
*remaining*, so a late-season batch is several times cheaper than a matchday-1 one.

**Never persist per-run fixture rows.** Persist only:

- Outcome distributions (bounded by fixture count)
- Scoreline histograms (bounded by observed scorelines × fixtures)
- Finishing-position histograms (20 positions × 20 teams)
- Team stat sums
- Reservoir seasons (~50 × 380 rows)

## Run count and convergence

`npm run mc:convergence` measures how far a batch's answers move between seeds: it runs the
same batch N times at each run count and reports the spread. Measured on the 2026/27 fixture
list with all 380 fixtures unplayed, 10 batches per row, drift weight 1, upset variance 0:

| Runs | title SD | top-4 SD | releg SD | pts SD | scoreline flips | outcome flips | ms |
|---|---|---|---|---|---|---|---|
| 1,000 | 0.53pp | 1.06pp | 0.79pp | 0.32 | 54.1% | 18.1% | 180 |
| 2,500 | 0.35pp | 0.79pp | 0.52pp | 0.22 | 45.3% | 12.6% | 411 |
| **5,000** | **0.26pp** | **0.56pp** | **0.39pp** | **0.16** | 39.1% | 9.6% | 845 |
| 10,000 | 0.22pp | 0.35pp | 0.26pp | 0.12 | 33.9% | 6.7% | 1,716 |
| 25,000 | 0.10pp | 0.24pp | 0.17pp | 0.07 | 25.4% | 4.8% | 4,350 |

SDs are pooled across the 20 clubs — the maximum over teams is a tempting statistic but a bad
one, because with a handful of batches each team's SD is itself noisy and taking the maximum of
20 noisy estimates selects for the luckiest error. Flip rates are the mean share of unplayed
fixtures where two batches disagree on the displayed pick.

### The probabilities converge; the picks do not

The probabilities behave exactly as sampling theory says: SD roughly halves per 4× runs. The
convergence rule is stated in the CLI — title SD < 0.5pp, relegation SD < 0.5pp, points SD <
0.25 — and **5,000 runs is the smallest tested value that meets it**.

The pick-flip rates are a different story, and they are reported but deliberately *not* gated.
Even at the 100,000-run cap, two batches still disagree on 10.2% of scorelines and 3.4% of
outcomes. That is not under-sampling — it is near-ties. The median fixture's top two scorelines
are separated by 1.73pp of probability mass, so which one is modal is close to a coin flip no
matter how long you run.

The calibrated strategy also amplifies this, by design. At 10,000 runs, comparing strategies on
the same batches:

| Strategy | scoreline flips | outcome flips |
|---|---|---|
| `likeliestScore` *(withdrawn)* | 11.6% | 6.5% |
| `likeliestResult` *(withdrawn)* | 39.7% | **0.8%** |
| `calibrated` | 34.3% | 6.7% |

`likeliestResult` picked the outcome mode, and outcome modes are well separated (median top-two
gap 23pp), so it almost never flipped. `calibrated` solves the season under a constraint on the
W/D/L counts, so when two fixtures are near-tied for which of them gets a draw, the constraint
must pick one — and that choice flips easily. This is the price of the calibration and is worth
knowing when a pick changes between two projections of the same week. `plausible` inherits it,
and adds the reservoir's own variation on top: a different batch samples different seasons.

### Choosing the default

`npm run week` defaults to 10,000. The measurements justify it rather than move it: it sits
comfortably inside every threshold, costs under two seconds, and buys a little margin over the
5,000 the rule alone would allow. Halving it would be defensible; raising it would buy visibly
stable picks only at run counts that cost minutes, and not even then.

Note the default does not scale with fixtures remaining, though the cost does — a late-season
batch simulating ~100 fixtures is several times cheaper than a matchday-1 one, so 10,000 gets
*more* conservative as the season goes on.

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

| Strategy | Behaviour |
|----------|-----------|
| `plausible` (default) | The calibrated solve aimed at one sampled season's draw profile rather than at the mean |
| `calibrated` | Assignment whose outcome counts match the simulation's own expectations |
| `random` | Replay one whole season from the reservoir (`prediction_active_sample`) |

All three are season-wide: the caller resolves the whole season and passes `choosePick` the answer
for one fixture (`seasonPick` for the two solved ones, `savedSample` for `random`). `choosePick` is
therefore a lookup rather than a decision, kept as the seam so callers need not know which source
applies.

`random` exists so the UI can show a **coherent** season rather than stitching independent per-fixture modal draws.

## Why the per-fixture strategies were withdrawn

`likeliestScore` and `likeliestResult` decided each fixture from its own histogram, and both were
withdrawn: every per-fixture rule picks the *mode* of a distribution, and the mode of a marginal is
not a draw from it. Measured over one 5,000-run batch on a full 380-fixture season, against the
batch's own expectation of 167 home / 85 draw / 128 away:

| Strategy | H | D | A | per-club draws sd |
|---|---|---|---|---|
| `likeliestScore` *(withdrawn)* | 83 | **265** | 32 | 7.98 |
| `likeliestResult` *(withdrawn)* | 243 | **0** | 137 | 0.00 |
| `calibrated` | 167 | **85** | 128 | 0.81 |
| `plausible` | 168 | **84** | 128 | 2.62 |

Both failures came from the same place, in opposite directions. A draw is essentially never the
single likeliest outcome — 22% against ~44% home — so `likeliestResult` returned *zero* draws, not
merely few. Conversely draw mass concentrates on 1–1 and 0–0 while win mass spreads across 1–0,
2–0, 2–1, so the modal scoreline is a draw in about 70% of fixtures.

This is a property of the collapse, not of the match model: the model itself draws 22.6% of
fixtures against an observed 23.9% (see [match-model.md](match-model.md)).

It is also not a quirk of this problem. **The mode of a high-dimensional distribution is atypical** —
the MAP configuration sits outside the *typical set*. The textbook example is the one here: for `n`
iid Bernoulli(0.22) draws the single most likely sequence is all-zeros, yet essentially no
realisation looks like that. The most likely season has no draws in it; no real season does. The
same distinction turns up as Viterbi (MAP sequence) versus posterior-marginal decoding in HMMs, and
as the standard Bayesian caution that in high dimensions the mode is not a representative point.

So `likeliestResult` was not misbehaving. It was doing exactly what a MAP point estimate does —
which is why the fix was to stop picking fixture by fixture, not to tune the rule.

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

One fixture from that batch, Everton v Crystal Palace:

```
p        H 0.438   D 0.244   A 0.317      argmax p     = homeWin
log p    H -0.825  D -1.410  A -1.148
bias     H  0      D +0.585  A +0.223     (β_EVE 0.278 + β_CRY 0.307)
score    H -0.825  D -0.825  A -0.924     argmax score = draw
```

The draw trails the home win by 19 percentage points, and `+0.585` in log space closes the gap
exactly; the draw takes the tie. That is the whole mechanism — the bias buys draws in the fixtures
where they are cheapest, and the constraint decides how many to buy.

Locked fixtures are included in the solve. Their distributions are degenerate, so they pin
themselves and contribute their known result to the targets; that is what keeps a batch's picks
stable as results land.

The per-team constraint is what makes it usable. A league-wide draw quota alone concentrates draws
on the evenly matched fixtures, leaving the strongest and weakest sides on nearly none.

### Prior art

The composite has no single canonical name, but none of the pieces are novel and it is worth
knowing what to search for.

The closest directly-named technique is **probability matching**, from ensemble weather
forecasting — specifically the **probability-matched mean**, introduced in
[Ebert (2001)](https://journals.ametsoc.org/mwr/article/129/10/2461/66323/Ability-of-a-Poor-Man-s-Ensemble-to-Predict-the).
The problem there has the same shape: an ensemble-mean precipitation field is unrealistically
smooth and under-forecasts heavy rain, so the mean supplies the spatial *pattern* while the values
are resampled from the pooled distribution of ensemble members. Keep the ranking, fix the marginal.
That is what this strategy does to a season.

The optimisation is a **transportation problem** — a degenerate assignment problem with 380 items,
three classes and prescribed class totals — and the biases are its **dual potentials**, which is
why they enter additively in log space. Because there are two sets of margins (per-team draws and
the league away total), the tightest formal match for the solver is **iterative proportional
fitting**, also called *raking* in survey statistics and the *RAS algorithm* in economics.
Alternating adjustments to hit prescribed margins is precisely what the sweeps do;
[Cuturi (2013)](https://papers.nips.cc/paper/4927-sinkhorn-distances-lightspeed-computation-of-optimal-transport)
sets out the same fixed point as Sinkhorn scaling for entropic optimal transport. The difference is
that Sinkhorn yields a soft, fractional coupling, where the exact-threshold coordinate solve here
yields a hard assignment — Sinkhorn's zero-temperature limit.

Adjacent, and useful if extending this:

- **Prior adjustment / class-prior shift** —
  [Saerens, Latinne & Decaestecker (2002)](https://direct.mit.edu/neco/article/14/1/21/6577/Adjusting-the-Outputs-of-a-Classifier-to-New-a),
  the same additive-offset-in-log-space idea, but correcting *probabilities* rather than
  constraining an assignment.
- **Per-group thresholding to hit a rate constraint** —
  [Hardt, Price & Srebro (2016)](https://arxiv.org/pdf/1610.02413) tune group-specific thresholds
  in the same structural way.
- **Balanced / size-constrained clustering**, usually solved by min-cost flow: the same constrained
  assignment shape.
- **Quantification / learning from label proportions** — related, but aimed at *estimating*
  prevalence rather than assigning under a known one.

### Two senses of "calibrated"

The word is overloaded in this repo, and the two senses are unrelated:

| Sense | Where | Meaning |
|---|---|---|
| Marginal calibration | this strategy | The *counts* of picked outcomes match their expectations |
| Probability calibration | `AccuracyReport.calibration` | Forecast *probabilities* match observed frequencies — the reliability bins in [accuracy.ts](../engine/src/engine/accuracy.ts) |

A model can have either without the other. This one already had the second — that is what the
reliability curve grades — and the strategy adds the first. "Marginal-calibrated assignment" or
"probability-matched picks" would be the unambiguous names if this is ever written up outside the
repo.

**A calibrated point estimate still gives every team 7–9 draws**, because every team's *expectation*
is ~8.5. The 7–14 spread across a real season is sampling noise, which only `random` reproduces.
The same caveat applies to points: any modal table is over-dispersed (Arsenal reads 100 against a
mean simulated 82), so `averagePoints` in the projections remains the honest central estimate.

## Why `calibrated` alone is still too even

`calibrated` matches the league's counts and each club's *mean* draws, and a mean has no variance
in it. Every club therefore lands within a draw or two of the league average — per-club draws come
out at sd 0.81 above, where ten real seasons average 2.70 (range 1.69–3.44). No single season has
ever looked like the average of all of them.

`plausible` runs the identical solve against the seasons in the batch's reservoir, using a
season's per-club draw counts as the targets, and returns that assignment. The season is chosen on
league total alone — the one whose draws come closest to what the batch expects, ties going to the
earliest sample. Reservoir order is stable and the comparison is strict, so the strategy is
deterministic given the batch.

The level has to be the criterion rather than something traded away. An earlier version ranked the
candidates by what they were worth under a predictor payoff, and that does not pick a typical
season, it picks the emptiest one: a draw is rarely a fixture's modal outcome, so a sample's draw
count and its expected points ran at about **r = −0.89**, and the winner landed ten draws under
the batch's own expectation.

The candidates are the sampled seasons alone. Including the mean-targeted solve would let the
strategy collapse back into `calibrated` on batches where no sample beat it, which is the one thing
a caller choosing it has ruled out. With no reservoir, it falls back to the mean.

Measured against `calibrated` on the 5,000-run batch above, the league counts hold (168/84/128
against 167/85/128) while the per-club spread roughly triples. `random` reaches the same realism by
replaying a sampled season outright, but forfeits the likelihood ordering within it.

## The withdrawn predictor payoff

Two things used to hang off a scoring rule — `exactScore` for a perfect scoreline, `correctResult`
for a right result with the wrong one — and both have gone.

A `maxPoints` strategy maximised `correctResult · P(outcome) + (exactScore − correctResult) ·
P(scoreline)` per fixture. At the default 3/1 it picked **zero** draws across a season, which is
the `likeliestResult` failure above with extra steps; draws only arrived once the premium was
steep enough to chase them (2 at 4/1, 37 at 6/1, 85 at 8/1), by which point it was picking a season
nobody would submit. Stored batches naming it fall onto the default.

Once it was gone the payoff had nothing left to move. Within a fixed outcome the `P(outcome)` term
is constant, so the best scoreline there is that outcome's modal one **at any premium** — the
payoff can only ever trade one outcome for another, and every remaining strategy pins its outcomes
by count constraints or by frequency. Sweeping `exactScore` from 1 to 100 moved zero fixtures in
four of the five strategies, and in `plausible` only flipped which sampled season won a tie. So the
rule, its two columns on `app_settings` and `predictions`, and its API routes were removed;
`migrateDropScoringRuleColumns` drops the columns from existing databases.

What survives is the frequency ranking the per-fixture distribution view needs:
`rankScorelineCandidates` returns one candidate per outcome — that outcome's modal scoreline —
most frequent first, so its first entry is the fixture's likeliest scoreline outright. No payoff
is involved.

## Active prediction

For export and default UI selection, the active prediction is the most recently *created* one (`getActivePrediction`) — the last simulation run. `listPredictions` orders the same way, so renaming an old batch or switching its strategy never promotes it over newer runs.
