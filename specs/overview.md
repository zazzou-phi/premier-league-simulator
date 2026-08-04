# Overview

## Purpose

Simulate a full Premier League season (20 clubs, 38 matchdays, 380 matches) with:

- Interactive score editing and single-season simulation
- Monte Carlo batches that yield title, Champions League, European, and relegation probabilities
- Locked real-world results that override every simulation path
- A weekly in-season loop (`npm run week`) that syncs results and Elo, grades the previous
  projection, and re-projects the rest of the season
- A static public site that cannot leak unrevealed future predictions

Adapted from a World Cup 2026 simulator. **Out of scope:** groups, knockouts, extra time, penalty shootouts, FIFA head-to-head tiebreakers.

## Packages

| Path | Role |
|------|------|
| `engine/` | Match model, Monte Carlo, SQLite (Drizzle), Hono API, CLIs |
| `web/` | React + Vite UI |
| `data/` | `teams.csv`, `fixtures.csv`, `premier-league.db` (DB gitignored) |

## Runtime modes

### Private (default)

Two processes:

1. Engine API on port **3123** (`cd engine && npm run api`)
2. Web dev server on port **2627** (`cd web && npm run dev`), proxying `/api` to the engine

Full read/write: settings, actual results, simulations, Monte Carlo, predictions.

### Public

Static build (`VITE_APP_MODE=public`, `npm run build:public` in `web/`). No API, no SQLite. Reads JSON under `web/public/data/` produced by `npm run export:public` in `engine/`. Deploy base path: `/premier-league-simulator/`.

Mutating operations are unavailable. All three views are reachable: Results is a read-only record
in both modes, rendered from `bootstrap.json` alone.

## Ports

| Process | Default | Override |
|---------|---------|----------|
| Engine API | `3123` | `npm run api -- --port N` |
| Web UI | `2627` | `PORT=N` |
| Web → API proxy | `3123` | `API_PORT` (and optional `API_HOST`) |

Keep `API_PORT` in sync with the engine port whenever either changes.

## Typical lifecycle

```
fetch:ratings  →  data/teams.csv
fetch:fixtures →  data/fixtures.csv
seed           →  data/premier-league.db
api + web      →  interactive private use
monte-carlo    →  predictions (distributions + reservoir)
fetch:results  →  lock finished scores + refresh Club Elo (re-run MC / export separately)
export:public  →  web/public/data/*.json
build:public   →  static site
```

## Key entry points

| Entry | Path |
|-------|------|
| API server | `engine/src/api/server.ts` |
| Hono app | `engine/src/api/app.ts` |
| Web app | `web/src/main.tsx` → `App.tsx` |
| Web proxy | `web/server.ts` |
| Seed | `engine/src/seed.ts` |
| Public export | `engine/src/export-public-cli.ts` |
