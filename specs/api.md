# HTTP API

Hono app: `engine/src/api/app.ts`. CORS enabled on `/api/*`. JSON errors via `ApiError` / `errorBody`.

Base URL in private web: proxied as `/api` → `http://127.0.0.1:${API_PORT}`.

## Health

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{ ok: true }` |

## Teams & fixtures

| Method | Path | Body / notes | Response |
|--------|------|--------------|----------|
| GET | `/api/v1/teams` | | `Team[]` |
| PUT | `/api/v1/teams/:id/elo` | `{ elo }` (500–3000) | `Team` |
| GET | `/api/v1/teams/elo-history` | `?teamId` optional | `TeamEloSnapshot[]`, oldest first |
| GET | `/api/v1/fixtures` | | `Fixture[]` |
| GET | `/api/v1/fixtures/next-matchday` | | `{ matchday }`, null once every fixture is locked |

## Settings

| Method | Path | Body | Range |
|--------|------|------|-------|
| GET/PUT | `/api/v1/settings/upset-variance` | `{ value }` | `0…1` |
| GET/PUT | `/api/v1/settings/season-elo-delta-weight` | `{ value }` | `0…5` |

## Actual results

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/actual-results` | `ActualMatchResult[]` |
| GET | `/api/v1/actual-results/state` | `SeasonState` from actuals only |
| PUT | `/api/v1/actual-results/:matchNumber` | `{ goalsHome, goalsAway }` — locks the fixture |
| DELETE | `/api/v1/actual-results/:matchNumber` | 204 |

`PUT` and `DELETE` have no client: the web UI is read-only and the sync path calls
`repo.setActualResult` directly. They remain as a manual escape hatch via `curl`.

## Simulations

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/simulations` | `?page&pageSize` → `{ items, total }` |
| POST | `/api/v1/simulations` | `{ name? }` → 201 `Simulation` |
| GET | `/api/v1/simulations/:id` | |
| PATCH | `/api/v1/simulations/:id` | `{ name }` required to rename |
| DELETE | `/api/v1/simulations/:id` | |
| GET | `/api/v1/simulations/:id/state` | `SeasonState` |
| PUT | `/api/v1/simulations/:id/matches/:matchNumber` | `{ goalsHome, goalsAway }` → `SeasonState` |
| DELETE | `/api/v1/simulations/:id/matches/:matchNumber` | clear score → `SeasonState` |
| POST | `/api/v1/simulations/:id/matches/:matchNumber/simulate` | single match |
| POST | `/api/v1/simulations/:id/simulate/season` | `{ upsetVariance? }` |
| POST | `/api/v1/simulations/:id/simulate/matchday` | `{ matchday?, upsetVariance? }` — omit matchday = next unfinished |

Locked fixtures reject manual set/clear (unless internal allow-locked path).

## Monte Carlo

| Method | Path | Body |
|--------|------|------|
| POST | `/api/v1/simulate/monte-carlo` | `{ runs, upsetVariance?, name? }` |

Default JSON response: prediction summary including `predictionId`, `runs`, `elapsedMs`, team projections.

With `Accept: application/x-ndjson`, streams:

1. `{ type: 'progress', … }` updates while running
2. Final `{ type: 'result', predictionId, runs, elapsedMs, teams }`

## Predictions

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/predictions/accuracy-history` | Grade per projection in season order — **registered before `/:id`** |
| GET | `/api/v1/predictions` | Paginated list |
| GET | `/api/v1/predictions/:id` | Metadata |
| PATCH | `/api/v1/predictions/:id` | `{ name?, pickStrategy? }` — the strategy is re-selectable after the fact, so retuning a batch never means re-running it |
| DELETE | `/api/v1/predictions/:id` | |
| GET | `/api/v1/predictions/:id/state` | Picked `SeasonState` |
| GET | `/api/v1/predictions/:id/projections` | `{ runs, teams }` |
| GET | `/api/v1/predictions/:id/accuracy` | `PredictionAccuracy` — graded against results recorded since it ran |
| GET | `/api/v1/predictions/:id/matches/:matchNumber/distribution` | `MatchDistribution` |
| GET | `/api/v1/predictions/:id/samples` | `{ count }` |
| PUT | `/api/v1/predictions/:id/active-sample` | `{ sampleIndex }` → updated state |

## Admin

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/v1/admin/regenerate-fixtures` | Loads/validates fixtures CSV; returns `{ fixtures, source }` — **does not write the DB** |

## Validation summary

| Input | Rule |
|-------|------|
| Scores | Integers 0–99 |
| Elo | 500–3000 |
| Upset variance | 0–1 |
| Season Elo weight | 0–5 |
| MC runs | 1–100_000 |

## Accuracy

`GET /api/v1/predictions/:id/accuracy` grades a stored batch. Only fixtures it predicted
blind count: a locked fixture's distribution just restates its known score, so those listed in
`prediction_locked_matches` are reported as `skippedLocked` and excluded from every metric.

```
{ predictionId, name, runs, pickStrategy, asOfMatchday, createdAt,
  graded, pending, skippedLocked,
  brierScore, uniformBrierScore, skillScore, logLoss,
  outcomeHitRate, scorelineHitRate,
  byMatchday: [{ matchday, graded, brierScore, logLoss, outcomeHitRate, scorelineHitRate }],
  calibration: [{ lowerEdge, count, meanPredicted, observedRate }],
  matches: [{ matchNumber, matchday, homeTeam, awayTeam, probabilities, actual,
              actualOutcome, predictedOutcome, predictedScoreline, outcomeHit,
              scorelineHit, scorelineProbability, brier, logLoss }] }
```

Brier is the three-outcome sum of squared errors (0 perfect, 2/3 uniform, 2 worst); log loss
floors probability at half a run so a zero-count outcome cannot diverge. `graded: 0` is a
normal state — a fresh batch has nothing to grade until its fixtures are played.

`GET /api/v1/predictions/accuracy-history` reduces every gradeable batch to one point
(`predictionId, name, asOfMatchday, createdAt, runs, graded, brierScore, skillScore,
logLoss, outcomeHitRate, scorelineHitRate`), sorted by `asOfMatchday` then `createdAt` —
the week-by-week "is the model improving" series. Batches with nothing graded are omitted
rather than reported as zero, which would read as a bad week rather than an unplayed one.
The literal path is registered ahead of `/api/v1/predictions/:id` so it is not parsed as
an id.
