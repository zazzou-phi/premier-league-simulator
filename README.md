# Premier League Simulator

Simulation engine and browser app for a full Premier League season: 20 clubs, 380 matches
across 38 matchdays, one table. Run Monte Carlo batches to get title, top-four and
relegation probabilities, edit individual scorelines, and record real results as the
season unfolds.

Adapted from a FIFA World Cup 2026 simulator. The match model, Elo ratings, consensus
layer and persistence patterns carry over; the group stage, knockout bracket and penalty
shootouts do not.

## Repository layout

| Path | Description |
|------|-------------|
| [`engine/`](engine/) | TypeScript simulation engine, SQLite persistence, REST API, CLI tools |
| [`web/`](web/) | React + Vite frontend (private dev server or static public build) |
| [`data/`](data/) | `teams.csv`, `fixtures.csv`, and the SQLite database (gitignored) |

## Quick start

Two processes: the engine API and the web app. Start them in separate terminals.

```bash
# Terminal 1 — engine API (http://localhost:3123)
cd engine
npm install
npm run fetch:ratings   # pull current club Elo from clubelo.com -> data/teams.csv
npm run fetch:fixtures  # pull 2026/27 fixtures from fixturedownload.com -> data/fixtures.csv
npm run seed            # load teams + fixtures into data/premier-league.db
npm run api             # listens on 3123 by default

# Terminal 2 — web UI (http://localhost:2627)
cd web
npm install
npm run dev             # proxies /api to http://127.0.0.1:3123
```

Open [http://localhost:2627](http://localhost:2627). If you see "Could not load the
simulator", the engine API is not running.

`fetch:ratings`, `fetch:fixtures`, and `seed` only need to run once — from then on
`npm run week` keeps everything current. Re-run `seed --force` to rebuild teams and
fixtures from scratch (this clears simulations, predictions, actual results and Elo
history).

### Ports

| Process | Default | Override |
|---------|---------|----------|
| Engine API | `3123` | `npm run api -- --port 3000` |
| Web UI | `2627` | `PORT=2628 npm run dev` |
| Web → API proxy | `3123` | `API_PORT=3000 npm run dev` |

The engine defaults to **3123** rather than 3000 so it does not collide with Docker and
other local services that commonly bind 3000. Keep `API_PORT` in sync with the engine
port whenever you change either one.

## The model

Each match is two independent Poisson draws. Expected goals come from fixed home/away
baselines plus an Elo gap:

```
delta = k x (eloHome - eloAway) / 400
lambdaHome = max(eps, baselineHome + delta / 2)
lambdaAway = max(eps, baselineAway - delta / 2)
```

For any unclamped match, `lambdaHome + lambdaAway = baselineHome + baselineAway`. Elo
only decides how lopsided the scoreline is — not how many goals the league scores overall.

Defaults are the four-season average (2021/22–2024/25): `baselineHome = 1.61` and
`baselineAway = 1.36` (~2.97 combined in an even match). `k = 1` and `eps = 0.05`.
See `specs/match-model.md` for the season breakdown.

Two knobs add realism on top:

- **Upset variance** — a log-normal form multiplier applied per team per match. The
  multiplier is rescaled by `exp(sigma^2)` so that turning it up makes results more
  volatile without inflating the number of goals.
- **In-season Elo drift** — after every match both teams get a standard Elo update.
  Effective Elo (base plus weighted delta) is refreshed once per matchday. Set the
  delta weight to 0 to disable.

### Standings

Points, then goal difference, then goals scored — the Premier League order. This differs
from the World Cup original, which applied a head-to-head mini-league before goal
difference per FIFA group-stage rules. Teams still level after goals scored are ordered
by name to keep the table deterministic.

## Monte Carlo

```bash
cd engine
npm run monte-carlo -- --runs 10000
```

Runs are **aggregated in memory and never persisted individually**. Storing every run
would mean 380 rows each; the World Cup project did this and its database grew to 1.6 GB.
Instead a batch is saved as a *prediction* holding only:

- per-fixture outcome and scoreline distributions (bounded by fixtures, not run count)
- a per-team finishing-position histogram
- a reservoir of 50 complete seasons, sampled uniformly at random

The reservoir is what lets `sample` consensus mode reproduce a *coherent* season rather
than stitching together independent per-fixture draws.

Roughly 1,000 seasons — 380,000 matches — simulate in about 350 ms.

## Consensus modes

A prediction collapses thousands of simulated seasons into one representative table.
How each fixture picks its scoreline is configurable:

| Mode | Behaviour |
|------|-----------|
| `scoreline` (default) | Modal scoreline within each outcome, then the most frequent of the three |
| `outcome` | Most frequent outcome, then its most frequent scoreline |
| `sample` | Replays one whole season from the reservoir |

## Running it through a season

Once a week, after the fixtures have been played:

```bash
cd engine
npm run week
```

That is the whole loop. It runs the steps in the order that matters — projecting before
syncing results would ignore the weekend — and does five things:

1. Pulls finished scores from fixturedownload and locks them
2. Refreshes Club Elo from clubelo.com, reporting the biggest movers
3. **Grades the projection those results just settled**
4. Re-projects the rest of the season, named `MD12 · 2026-11-03` after the round it faces
5. Rewrites the public JSON snapshot

Preview a week without writing anything with `npm run week -- --dry-run`.

If the remote has *changed* a scoreline you already recorded, the command stops before
touching anything. That is usually a correction, but it silently rewrites history and every
stored simulation, so it asks first — review with `npm run fetch:results -- --dry-run`, then
re-run with `--force`.

| Flag | Effect |
|------|--------|
| `--runs N` | Monte Carlo runs for the new projection (default 10,000) |
| `--name` | Override the auto-generated `MD<n> · <date>` name |
| `--dry-run` | Report what would change; write nothing |
| `--no-ratings` / `--no-export` | Skip the Elo refresh / the public snapshot |
| `--force` | Accept changes to results already recorded |

The database is gitignored, so commit `data/teams.csv` and `data/fixtures.csv` each week —
between them they are the recoverable record of what was known when. The command prints the
commands at the end.

### The individual steps

`npm run week` is a wrapper; each step is still available on its own.

```bash
npm run fetch:results            # lock scores + refresh Elos in DB / teams.csv
npm run fetch:results -- --dry-run   # preview without writing
npm run fetch:results -- --no-ratings  # scores only
```

Recording a real result locks that fixture. Locked fixtures are never overwritten by a
simulation, are replayed verbatim in every Monte Carlo run, and are propagated into every
stored simulation so the whole app agrees with reality.

Results updates `actual_match_results` (and refreshes `data/fixtures.csv`); ratings update
team Elo in SQLite and `data/teams.csv`, and append a dated row per club to
`team_elo_history` — `teams.elo` is overwritten in place, so that table is the only record
of what the model believed in October.

## Scoring a projection

```bash
cd engine
npm run score                     # most recent projection with results to grade
npm run score -- --prediction 12  # a specific one
npm run score -- --all --json     # every projection, as JSON
npm run score -- --matches        # add the per-fixture breakdown
```

Only fixtures a projection called **blind** are graded. Monte Carlo replays a locked result
verbatim in every run, so grading one would measure the lock rather than the model; each
batch records the fixtures that were already locked when it ran and those are excluded.

| Metric | Meaning |
|--------|---------|
| Brier score | Summed squared error across home/draw/away. 0 perfect, 2/3 a uniform guess, 2 maximally wrong |
| Skill score | `1 - brier/0.667`. Positive means it beat guessing 1/3 each |
| Log loss | `-ln P(actual)`, floored at half a run so a zero-probability outcome cannot diverge |
| Outcome hit rate | How often the displayed consensus called W/D/L right |
| Exact scoreline | How often it got the scoreline on the nose |
| Calibration | Predicted probability vs observed frequency, in deciles — things called 30% likely should happen about 30% of the time |

Calibration is the one to watch over a run of matchdays: if the model is consistently
over- or under-confident, that is the signal to adjust upset variance and Elo drift.

The same numbers are in the UI under **Options → Manage Projections → Accuracy**, which
adds a season-order skill trend across projections and the per-fixture grading list.

Elsewhere in the UI: the header shows which round is next (`MD12 next`), and **Options →
Team Ratings** gains a Change column and trend line per club, read from the dated Elo
snapshots.

## Public site

The public build is static: no API, no SQLite. It reads JSON snapshots from
`web/public/data/` and runs personal simulations in the browser.

```bash
cd engine
npm run export:public
```

This writes `meta.json`, `bootstrap.json`, `league-state.json` and `projections.json`.

Exports use a **kickoff reveal policy**: predictions for fixtures that have not kicked off
yet are blanked out and the published table is recomputed from revealed matches only, so
the snapshot cannot leak future predictions. Recorded real results are always included.

Build it with `npm run build:public` in `web/`.

## Deployment

Two independent targets: the full private app runs in Docker, the read-only public site
runs on GitHub Pages.

### Private app (Docker)

The image bundles both processes — the engine API on `3123` (internal) and the web server
on `2627` — and `docker/entrypoint.sh` starts the API first, waits for `/health`, then
hands the foreground to the web server. SQLite is **not** baked into the image: the
entrypoint seeds `data/premier-league.db` from `teams.csv` and `fixtures.csv` on first
boot if the file is missing, so mount `./data` to keep the database across restarts.

```bash
docker compose up --build
```

Open [http://localhost:2627](http://localhost:2627).

To ship it to another host, build for that host's architecture, save the image and load it
there:

```bash
docker buildx build --platform linux/amd64 -t premier-league-simulator-app:latest --load .
docker save premier-league-simulator-app:latest | gzip > premier-league-simulator.tar.gz
scp premier-league-simulator.tar.gz <host>:/tmp/          # then, on the host:
docker load < /tmp/premier-league-simulator.tar.gz
```

An untracked `deploy-docker.sh` in the repository root is a convenient place to keep those
steps with your own host baked in; both it and the tarball are gitignored.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `2627` | Web server port (also change the compose mapping) |
| `API_PORT` | `3123` | Engine API port inside the container |
| `DB_PATH` | `/app/data/premier-league.db` | SQLite location |

### Public site (GitHub Pages)

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) runs
`npm run build:public` and publishes `web/dist` on every push to `main`. The public build
uses base path `/premier-league-simulator/`, which must match the GitHub repository name.

To update what visitors see: run `npm run week` (or `npm run export:public`) in `engine/`,
commit the regenerated `web/public/data/*.json`, and push.

## Data

Club Elo ratings come from [clubelo.com](http://clubelo.com), filtered to the English
top flight (`Country=ENG`, `Level=1`). Fixtures come from
[fixturedownload.com](https://fixturedownload.com/)'s English Premier League 2026/27
schedule (UK wall-clock kickoffs). The circle-method generator in `schedule.ts` remains
available for tests that need a synthetic full season.

## Tests

```bash
cd engine
npm test
```

171 tests covering the schedule generator, fixture import, results sync, Elo history,
match model calibration, standings tiebreakers, Monte Carlo aggregation, prediction
grading and trending, the repository, the HTTP API, and public-export redaction.

## CLI reference

| Command | Purpose |
|---------|---------|
| `npm run week` | Advance the season one week: results → Elo → grade → project → export |
| `npm run score` | Grade a stored projection against what actually happened |
| `npm run fetch:ratings` | Refresh `data/teams.csv` from clubelo |
| `npm run fetch:fixtures` | Download the 2026/27 fixture list into `data/fixtures.csv` |
| `npm run fetch:results` | Lock finished scores from fixturedownload; refresh Club Elo (`--dry-run`, `--db`, `--no-ratings`) |
| `npm run seed` | Create/populate the database (`--force` to rebuild) |
| `npm run api` | Start the REST API on port 3123 (`--port`, `--db`, `--seed`) |
| `npm run simulate:season` | Simulate a stored season from the command line |
| `npm run monte-carlo -- --runs N` | Run a batch and print projections |
| `npm run export:public` | Write the static JSON snapshot |
