# Agent notes

Premier League season simulator: TypeScript engine (`engine/`) + React/Vite UI (`web/`) + CSV/SQLite data (`data/`). Adapted from a World Cup 2026 simulator — keep PL semantics (no groups/knockouts/penalties; points → GD → GF → name).

## Layout

| Path | Role |
|------|------|
| `engine/` | Match model, Monte Carlo, SQLite (Drizzle), Hono API, CLIs |
| `web/` | React app; private mode talks to the API, public mode is static JSON |
| `data/` | `teams.csv`, `fixtures.csv`, `premier-league.db` (DB is gitignored) |

Default ports: API `3123`, web `2627`. Keep `API_PORT` in sync if either changes.

## Domain invariants

- Match model: two independent Poisson draws from fixed home/away baselines plus Elo gap. Do not inflate total goals when raising upset variance (form multiplier is mean-rescaled).
- Monte Carlo runs are aggregated in memory — never persist per-run fixtures. Batches store outcome/scoreline distributions, finishing histograms, and a small season reservoir (~50) for the `random` strategy.
- Locked (actual) results are authoritative: never overwrite them in sim, replay them in every MC run, and keep stored simulations consistent with them.
- Because locked results are replayed verbatim, they carry no predictive content: grading a prediction must exclude the fixtures recorded in `prediction_locked_matches`, never score a batch on results it was handed.
- `teams.elo` is overwritten by each ratings sync; the dated record lives in `team_elo_history` (and the tracked `data/teams.csv`).
- Public export uses kickoff reveal: blank unrevealed predictions and recompute the published table from revealed matches only so snapshots cannot leak futures.
- Prefer real fixtures/ratings pipelines over the circle-method generator except in tests that need a synthetic season.

## Working rules

- Match existing TypeScript style, naming, and file placement; prefer extending nearby code over new abstractions.
- Scope changes tightly. No drive-by refactors, unrelated cleanups, or docs the user did not ask for.
- Do not commit unless the user explicitly asks. Never amend pushed commits, force-push main, or skip hooks unless requested.
- Do not invent APIs, CSV columns, or DB schema — read the code first. Prefer `npm test` in `engine/` after model/API/persistence changes.
- Public vs private web builds differ (`VITE_APP_MODE=public`); do not assume the API is available in the public static site.
- Communicate briefly; cite code with `startLine:endLine:path` when pointing at existing files.

## Commands

```bash
cd engine && npm test
cd engine && npm run api          # :3123
cd web && npm run dev             # :2627, proxies /api
cd engine && npm run week         # in-season loop: results -> Elo -> grade -> project -> export
cd engine && npm run score        # grade a stored prediction
cd engine && npm run export:public
```
