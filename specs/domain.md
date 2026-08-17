# Domain

Core types live in `engine/src/engine/types.ts`. Schedule constants in `engine/src/engine/schedule.ts`.

## Season shape

| Constant | Value |
|----------|-------|
| Teams | 20 |
| Matchdays | 38 |
| Matches per matchday | 10 |
| Total matches | 380 |

Each team plays every other team home and away (19 home, 19 away). Fixture integrity is validated on CSV import and seed: exact count, home/away balance, unique home–away pairs.

Production fixtures come from `data/fixtures.csv` (fixturedownload). The circle-method generator in `schedule.ts` exists for tests that need a synthetic full season — prefer the real pipeline elsewhere.

## Entities

### Team

`id`, `name`, `shortName`, `crest` (nullable), `elo`.

Elo is the strength input to the match model. Editable via API in private mode (range 500–3000).

### Fixture

`matchNumber` (PK), `matchday`, `date` (`YYYY-MM-DD`), `time` (`HH:MM`), `teamHomeId`, `teamAwayId`.

Kickoffs are UK wall-clock times (`Europe/London`, including BST). Used by the public kickoff-reveal policy.

### Simulation

A named interactive season: rows in `simulations` plus per-fixture `simulation_matches` (`scheduled` | `played` with optional goals).

Created with current actual results already applied. Manual edits cannot overwrite locked fixtures unless explicitly allowed for internal sync.

### Actual match result

Authoritative real-world score for a fixture: `matchNumber`, `goalsHome`, `goalsAway`, `recordedAt`.

When set:

1. Stored in `actual_match_results`
2. Propagated into **all** `simulation_matches` for that fixture
3. Treated as locked in season state (`ResolvedMatch.locked`)
4. Replayed verbatim in every Monte Carlo run
5. Always wins over picked seasons when building prediction state

### Season state

UI/API aggregate: teams, resolved matches (with lock flags), standings, `matchesPlayed` / `matchesTotal`. Built for simulations, actual-results-only views, and picked seasons.

### Prediction

Persisted Monte Carlo batch. Does **not** store per-run fixtures. Holds:

- Run count and settings snapshot (`upsetVariance`, `seasonEloDeltaWeight`, `pickStrategy`)
- Per-fixture outcome and scoreline distributions
- Per-team finishing-position histograms and summed stats
- Reservoir of complete sampled seasons (~50)
- Active sample index for the `random` strategy

## Standings

Computed by `computeLeagueStandings` (`engine/src/engine/standings.ts`).

**Order:** points → goal difference → goals for → team name (`localeCompare`).

This is Premier League order. Do **not** apply FIFA group-stage head-to-head mini-leagues.

Win = 3 points, draw = 1, loss = 0.

## League zones

| Zone | Positions |
|------|-----------|
| Champion | 1 |
| Champions League | 1–4 |
| Europa League | 5 |
| Relegation | bottom 3 (18–20 for 20 teams) |

Used for projection probabilities and UI highlighting (`zoneForPosition`).

## Score constraints

Goals are integers in `0…99` (`assertValidScore`). Null goals mean unplayed / redacted.
