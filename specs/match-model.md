# Match model

Implementation: `engine/src/engine/matchSimulator.ts`, season Elo in `engine/src/engine/seasonElo.ts`, season loop in `engine/src/simulation/seasonSimulator.ts`.

## Expected goals

Each match is two independent Poisson draws. Lambdas come from fixed home/away baselines plus an Elo gap:

```
delta = eloGoalScale × (eloHome − eloAway) / 400

λ_home = max(eps, baselineHome + delta / 2)
λ_away = max(eps, baselineAway − delta / 2)
```

For any unclamped match, `λ_home + λ_away = baselineHome + baselineAway`. Elo only decides how lopsided the scoreline is — not how many goals the league scores overall.

### Baseline calibration

Defaults are the four-season average home/away goals per match (2021/22–2024/25, 380 fixtures each):

| Season | Home | Away | Combined |
|--------|------|------|----------|
| 2024/25 | 1.51 | 1.42 | 2.93 |
| 2023/24 | 1.80 | 1.48 | 3.28 |
| 2022/23 | 1.63 | 1.22 | 2.85 |
| 2021/22 | 1.51 | 1.31 | 2.82 |
| **Average** | **1.61** | **1.36** | **2.97** |

| Parameter | Default | Role |
|-----------|---------|------|
| `baselineHome` | `1.6125` | Even-match expected home goals |
| `baselineAway` | `1.3575` | Even-match expected away goals |
| `eloGoalScale` (`k`) | `1` | Goals worth of an Elo gap of 400 |
| `eps` (`MIN_LAMBDA`) | `0.05` | Floor so extreme mismatches stay simulatable |
| Elo scale | `400` | Standard Elo denominator |

## Upset variance

Per team, per match: a log-normal form multiplier with sigma = `upsetVariance` (default `0.2`, settings range `0…1`).

The multiplier is **mean-rescaled** by `exp(σ²)` so raising variance increases result volatility without inflating total expected goals. Setting sigma to `0` disables the effect.

Persisted in `app_settings.upset_variance`; also snapshotted on each prediction.

## In-season Elo drift

After every match, both teams receive a standard Elo update (`matchEloDelta`, K = 20 by default).

Effective Elo for simulation: `base + weight × delta`. Weight default `1`, allowed `0…5` (`app_settings.season_elo_delta_weight`). Weight `0` disables drift.

Within a season simulation, Elo deltas apply after each match, but the form used for lambdas is refreshed on a matchday boundary so matches on the same matchday share start-of-matchday effective Elo.

## Season simulation

`simulateSeason`:

1. Start from fixtures and optional locked results
2. For unlocked fixtures, draw Poisson scorelines using current effective Elo and settings
3. For locked fixtures, replay stored goals
4. Apply Elo updates as matches resolve
5. Return a complete set of scorelines for the season

Interactive paths (`SeasonRunner`) can simulate one match, one matchday, or the rest of the season, skipping already-played (and respecting locked) fixtures.
