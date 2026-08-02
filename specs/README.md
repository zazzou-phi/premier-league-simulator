# Specs

Engineering specifications for the Premier League season simulator. These describe intended behaviour as implemented in `engine/`, `web/`, and `data/`. Prefer the code when a detail conflicts; update these docs when behaviour changes.

| Doc | Covers |
|-----|--------|
| [overview.md](overview.md) | Purpose, packages, modes, ports, lifecycle |
| [domain.md](domain.md) | Season shape, types, standings, zones, actual results |
| [match-model.md](match-model.md) | Poisson lambdas, upset variance, in-season Elo |
| [monte-carlo.md](monte-carlo.md) | Aggregation, reservoir, consensus modes, projections |
| [persistence.md](persistence.md) | CSV schemas, SQLite tables, seed, sync |
| [api.md](api.md) | Hono REST surface |
| [web.md](web.md) | React UI views and private vs public behaviour |
| [public-export.md](public-export.md) | Static snapshot and kickoff reveal |
| [invariants.md](invariants.md) | Rules that must not break |
| [cli.md](cli.md) | Engine npm scripts and CLI flags |

Related: [../README.md](../README.md) (user-facing), [../AGENTS.md](../AGENTS.md) (agent working notes).
