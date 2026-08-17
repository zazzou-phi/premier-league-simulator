# Monte Carlo & consensus

Implementation: `engine/src/simulation/monteCarlo.ts`, consensus in `engine/src/engine/consensus.ts`, persistence via `Repository.savePredictionFromMonteCarlo`.

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

## Consensus modes

A prediction collapses distributions into one representative `SeasonState`. Mode is stored on the prediction (`consensusMode`). Actual locked results always override consensus scorelines.

| Mode | Behaviour |
|------|-----------|
| `scoreline` (default) | Modal scoreline within each outcome, then the most frequent of those three candidates |
| `outcome` | Most frequent outcome, then its most frequent scoreline (ties: win beats draw; two wins prefer higher Elo) |
| `expectedPoints` | Of those same three candidates, the one maximising expected predictor-game points |
| `sample` | Replay one whole season from the reservoir (`prediction_active_sample`) |

`sample` exists so the UI can show a **coherent** season rather than stitching independent per-fixture modal draws.

## Expected-points consensus

For a predictor game paying `exactScore` for a perfect scoreline and `correctResult` for a right
result with the wrong scoreline — the higher of the two, not both — a pick is worth:

```
correctResult · P(outcome) + (exactScore − correctResult) · P(scoreline)
```

Searching only the three modal-per-outcome candidates is exact, not an approximation: within one
outcome the `P(outcome)` term is constant, so the best pick there is that outcome's modal scoreline,
and a scoreline no run produced scores `P(scoreline) = 0`. Scored in raw run counts.

`scoreline` and `outcome` are the degenerate ends of the same formula — `correctResult = 0` gives
one, `exactScore = correctResult` the other.

The payoff lives in `app_settings` (`exact_score_points`, `correct_result_points`, defaulting to
3/1) and is snapshotted onto each prediction like `upsetVariance`, so a stored pick can be traced
to the scoring rule it was optimising.

Because draw probability mass concentrates on 1–1 and 0–0 while win mass spreads across 1–0, 2–0,
2–1, this mode picks noticeably more draws than `outcome` does, and more as `exactScore` rises.

## Active prediction

For export and default UI selection, the active prediction is the most recently `updatedAt` prediction (`getActivePrediction`).
