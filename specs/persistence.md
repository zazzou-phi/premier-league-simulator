# Persistence

## Files

| Path | Tracked | Role |
|------|---------|------|
| `data/teams.csv` | yes | Club metadata + Elo |
| `data/fixtures.csv` | yes | Full season schedule (+ optional Result column) |
| `data/premier-league.db` | **no** (gitignored) | SQLite working store (+ WAL/SHM) |

Default DB path: `data/premier-league.db` (`getDefaultDbPath`). WAL mode and foreign keys on.

## CSV: teams

Columns: `id`, `name`, `short_name`, `clubelo_name`, `elo`. The database also carries `teams.anchor_elo` — the last rating from outside the model, which `elo` is recomputed from. It is pinned once and never overwritten, so the recompute cannot drift on top of drift.

Loaded by `parseTeamsCsv` / `loadTeams` → `Team` with `crest: null`.

Source: originally `fetch:ratings` from clubelo.com, filtered `Country=ENG`, `Level=1`. Since 22 August 2026 the `elo` column is maintained by `syncTeamRatingsFromResults` instead; `clubelo_name` is still the join key for the `--clubelo` path.

## CSV: fixtures

fixturedownload columns include: `Match Number`, `Round Number`, `Date`, `Location`, `Home Team`, `Away Team`, `Result`.

- Kickoff: `DD/MM/YYYY HH:MM` → ISO date + `HH:MM` (`parseFixtureKickoff`)
- Result: `1 - 0` style or empty (`parseFixtureResult`)
- Team name aliases via `FIXTURE_TEAM_ALIASES` (e.g. `Man Utd` → `Manchester United`)

Validation: 380 fixtures; each team 19 home / 19 away; unique home–away pairs.

## Seed

`npm run seed` (`engine/src/db/seed.ts`):

- Creates schema if needed
- Loads teams and fixtures from CSV
- Initializes `app_settings` defaults

`seed --force` clears predictions (including locked-match provenance), simulations, actuals, Elo history, fixtures, and teams, then reloads CSVs.

## Results sync

`npm run fetch:results` pulls finished scores from the remote fixturedownload CSV into `actual_match_results` and refreshes `data/fixtures.csv`. It also updates ratings in the DB and `data/teams.csv` (ids stay fixed) and appends a dated `team_elo_history` snapshot. Flags: `--dry-run`, `--db`, `--no-ratings`, `--clubelo`.

That upstream has been unreachable since 22 August 2026, so ratings are no longer fetched. `syncTeamRatingsFromResults` recomputes them instead, as `teams.anchor_elo` plus the Elo update from every real result to date; `--clubelo` opts back into the old feed. Because it recomputes from the anchor rather than incrementing, re-running is a no-op and a corrected scoreline is absorbed rather than compounded. See `specs/match-model.md`.

Does **not** re-run Monte Carlo or public export — those are separate steps. `npm run week`
chains all of them in the required order and refuses to continue when the remote has changed
a result already recorded (override with `--force`).

## SQLite schema

Defined in `engine/src/db/schema.ts` (Drizzle) with DDL also applied in `client.ts`.

| Table | Purpose |
|-------|---------|
| `teams` | Clubs + Elo |
| `fixtures` | Schedule |
| `app_settings` | Singleton (`id=1`): `upset_variance`, `season_elo_delta_weight` |
| `simulations` | Named interactive seasons |
| `simulation_matches` | Per-sim scores (`scheduled` \| `played`) |
| `actual_match_results` | Locked real scores |
| `team_elo_history` | Dated Elo snapshot per club (`team_id`, `as_of`, `elo`) |
| `predictions` | MC batch metadata + pick strategy + settings snapshot + provenance (`as_of_matchday`, `locked_count`) |
| `prediction_locked_matches` | Fixtures already locked when the batch ran; excluded from grading |
| `prediction_match_outcomes` | H/D/A counts per fixture |
| `prediction_match_scorelines` | Scoreline histogram |
| `prediction_team_positions` | Finishing histogram |
| `prediction_team_stats` | Summed points / GF / GA / position |
| `prediction_sampled_seasons` | Reservoir seasons |
| `prediction_active_sample` | Active reservoir index for `sample` mode |

Migrations may drop legacy attack/defence columns, rename `consensus_mode` to `pick_strategy`, remap old strategy names
(`floor` / `rounded` → `scoreline`), and add the prediction provenance columns
(`as_of_matchday` null, `locked_count` 0 on pre-existing rows).

## Elo history

`teams.elo` is overwritten in place by every ratings sync, so a past prediction cannot
otherwise be tied to the ratings it used. `fetch:results` / `week` append one
`team_elo_history` row per club, **dated by the last real result priced in — not by the day the
sync ran**.

That key comes from the data on purpose. A rating only moves when a match is played, so keying
the snapshot to the clock records the same number again on every idle run: three runs in a quiet
week wrote three identical rows. Beyond the waste, a flat point landing on top of a real one
makes the last move unreadable, because `groupEloSeries` reports the delta between the final two
snapshots. Deriving the key from the results instead gives one point per round, an x-axis that
means "after the round played on this date", and a repeat run that collapses onto the row it
already wrote. A corrected scoreline revises that row in place rather than adding a second point
implying the club moved twice.

A run that changes nothing and finds its date already recorded skips the write altogether.
`seed` writes a baseline snapshot so the table is never empty before the first round.
`data/teams.csv` is the tracked mirror — commit it weekly for a git-level history.

### Rebuilding it

`npm run backfill:elo-history` replays every recorded result round by round and writes a
snapshot per round, dated to that round's last fixture. Use it to fill rounds that passed
without anyone running the week loop, or to rebuild the series after restoring a database.

The weekly sync only ever records where ratings stand *now*, so the series is otherwise as
sparse as the loop was run. Under clubelo that was permanent — a rating for 12 October could
only be captured on 12 October. Recomputing from an anchor makes every past round derivable
instead, so nothing is lost by not having run the loop that week.

Each round is computed cumulatively from `teams.anchor_elo` rather than by carrying a running
total forward, so the last point is by construction identical to the live rating. Re-running
overwrites the rows it wrote before, so it is safe at any time. `--dry-run` reports the rounds
it would write without touching anything.

## Prediction provenance

`savePredictionFromMonteCarlo` records, alongside the aggregates:

- `as_of_matchday` — lowest matchday still unplayed when the batch ran
- `locked_count` — how many fixtures were already locked
- `prediction_locked_matches` — which ones

A locked fixture's distribution just restates its known score, so it carries no predictive content.
Grading (`repo.getPredictionAccuracy`) excludes them; without this record a batch would be
scored on results it was handed.

## Repository responsibilities

`engine/src/db/repository.ts` is the persistence boundary:

- CRUD for teams (Elo), settings, simulations, matches, actuals, predictions
- Build `SeasonState` for sim / actuals / picks
- Overlay actuals over simulation rows when building season state
- Save MC aggregates + reservoir
- Reject edits to locked matches (`MatchLockedError`)
