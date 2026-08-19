# CLI & scripts

All commands run from `engine/` unless noted. Web scripts run from `web/`.

## Engine

| Script | Purpose | Notable flags |
|--------|---------|---------------|
| `npm run fetch:ratings` | Club Elo → `data/teams.csv` | |
| `npm run fetch:fixtures` | 2026/27 schedule → `data/fixtures.csv` | |
| `npm run week` | The in-season loop: results → Elo → grade previous → project → export | `--runs`/`-n`, `--name`, `--dry-run`, `--no-ratings`, `--no-export`, `--out`, `--force`, `--db` |
| `npm run score` | Grade a stored prediction against real results | `--prediction`/`-p`, `--all`, `--json`, `--matches`, `--db` |
| `npm run fetch:results` | Lock finished scores from remote CSV; refresh Club Elo | `--dry-run`, `--db`, `--no-ratings` |
| `npm run seed` | Create/populate SQLite from CSVs | `--force` (rebuild; clears sims/predictions/actuals) |
| `npm run api` | REST API (default port 3123) | `--port`, `--db`, `--seed` |
| `npm run simulate:season` | CLI season simulation | |
| `npm run monte-carlo` | Run batch; print projections | `--runs` / `-n`, `--name`, `--db`, `--no-save` |
| `npm run mc:convergence` | Measure run-to-run spread and recommend a run count | `--runs` (list), `--batches`, `--seed`, `--weight`, `--upset`, `--json`, `--db` |
| `npm run export:public` | Write static JSON snapshot | `--out` (default `web/public/data`), `--db` |
| `npm test` | Vitest suite | |
| `npm run test:watch` | Watch mode | |

## Web

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server :2627, proxies `/api` |
| `npm run build` | Private production build |
| `npm run build:public` | Public static build (`VITE_APP_MODE=public`) |

## Test coverage expectations

Engine tests (`engine/tests/`) protect:

- Schedule generator
- Fixture CSV parse/validation
- Results sync
- Match model calibration (λ sum, home/away baselines, Elo gap, Poisson)
- Standings tiebreakers, zones, and seeded starting tables
- Monte Carlo aggregation, remainder-only simulation, and locked back-fill
- Prediction grading (Brier, log loss, calibration, locked-fixture exclusion)
- Dated Elo history and mover reporting
- Repository (read-time actual overlay, predictions, settings)
- HTTP API routes and error codes
- Public snapshot redaction / kickoff reveal

After model, API, or persistence changes: `cd engine && npm test`.
