# Match model

Implementation: `engine/src/engine/matchSimulator.ts`, season Elo in `engine/src/engine/seasonElo.ts`, season loop in `engine/src/simulation/seasonSimulator.ts`.

## Expected goals

Each match is two independent Poisson draws. Each side's rate is its own log-linear function
of the Elo gap:

```
gap = (eloHome − eloAway) / 400

λ_home = baselineHome × exp(eloSlopeHome × gap)
λ_away = baselineAway × exp(eloSlopeAway × gap)
```

The two sides are estimated **independently**, so the match total is not fixed: a mismatch is
predicted to be higher scoring than an even fixture. Because the form is multiplicative, a
rate can never reach zero and no floor is needed.

### Calibration

Maximum-likelihood estimates from a log-link Poisson fit over 2021/22–2025/26 (1900 matches),
using clubelo ratings as they stood on each match date. Reproduce with `npm run fit:lambdas`
(see `engine/src/fitting`).

| Parameter | Default | Std. error | Role |
|-----------|---------|-----------|------|
| `baselineHome` | `1.5292` | 0.019 (log) | Even-match expected home goals |
| `baselineAway` | `1.2757` | 0.021 (log) | Even-match expected away goals |
| `eloSlopeHome` | `0.7388` | 0.045 | Log response of home goals to a 400-Elo gap |
| `eloSlopeAway` | `−0.7218` | 0.050 | Log response of away goals to a 400-Elo gap |
| Elo scale | `400` | — | Standard Elo denominator |

The baselines are *even-fixture* rates, not league averages. Averaged over a real fixture
list the model reproduces the observed 1.597 home / 1.329 away, because `exp` is convex and
mismatches pull the average above the even-fixture value.

### Why the total is no longer fixed

The previous model was additive (`baselineHome + delta/2`), which pinned every fixture to the
same total of 2.97 goals. Real matches do not behave that way, and simulating the historical
fixture list now reproduces the gradient:

| \|Elo gap\| | Matches | Simulated total | Observed total |
|---|---|---|---|
| 0–100 | 912 | 2.82 | 2.84 |
| 100–200 | 569 | 2.91 | 2.87 |
| 200–300 | 298 | 3.08 | 3.10 |
| 300+ | 121 | 3.43 | 3.38 |

## Upset variance

**Default `0` — the shock is off.** It remains available as a user setting; the mechanics
below describe what happens when it is raised.

Per match, the form shock splits into two independent pieces, governed by `upsetVariance`
(sigma, default `0`, settings range `0…1`) and `tempoShare` (default `0.6`):

```
sigmaDiff   = sigma × sqrt(1 − tempoShare)
sigmaShared = sigma × sqrt(2 × tempoShare)
```

- **Differential** — two log-normal draws applied as a ratio (`homeForm / awayForm`), so one
  side gains exactly what the other loses. This is "who was better on the day".
- **Shared** — a single log-normal draw applied to *both* lambdas, moving the match total
  without touching the balance. This is "how open the game was".

Every multiplier is **mean-rescaled** (the ratio by `exp(sigmaDiff²)`) so expected goals stay
on the baseline total at any sigma or share. Sigma `0` disables the effect entirely.

The split keeps each lambda's log-variance at `2σ²` regardless of the share, so `tempoShare`
redistributes volatility rather than adding it.

### Why the split exists

A purely differential shock can only push the lambdas apart, so it monotonically suppresses
draws — raising the "upset" slider made results *more* decisive. Measured at an even fixture:

| sigma | 0 | 0.2 | 0.35 | 0.5 |
|---|---|---|---|---|
| P(draw), share = 0 | 24.2% | 22.4% | 20.2% | 18.8% |
| P(draw), share = 0.6 | 24.2% | 24.1% | 24.1% | 25.0% |

`0.6` is the measured draw-neutral share, and it is why the share exists at all.

### Why sigma defaults to zero

Fitting sigma, the share and a Dixon-Coles `rho` against the same 1900 matches (stage 2 of
`npm run fit:lambdas`) drives sigma to the boundary at **0**. The likelihood falls
monotonically as sigma rises, for every share.

The reason is dispersion. A mean-1 multiplicative shock can only *add* variance, and league
goals are already fractionally **under**-dispersed relative to Poisson at these fitted rates —
observed sd of total goals `1.662` against the Poisson `1.722`. On a held-out season the old
`0.2` default cost about `0.016` nats per match versus switching the shock off.

`rho` fits to `−0.026` and is not significant (χ²(1) = 0.73, p = 0.39), so no Dixon-Coles
correction is applied.

This rules out *this mechanism*, not the idea of match-to-match variation: a family able to
represent under-dispersion could plausibly beat plain Poisson here. The residual gap it would
have to explain is small — the model draws 22.6% of fixtures against an observed 23.9%, a
difference of about 1.5 standard errors over five seasons.

`upsetVariance` is persisted in `app_settings.upset_variance` and snapshotted on each
prediction. `tempoShare` is currently an engine-level constant, not a user setting.

## In-season Elo drift

After every match, both teams receive a standard Elo update (`matchEloDelta`, K = 20 by default).

Effective Elo for simulation: `base + weight × delta`. **Weight default `0` — drift off**,
allowed `0…5` (`app_settings.season_elo_delta_weight`).

### Why drift defaults to zero

`fetch:ratings` overwrites each club's base Elo with clubelo's *current* rating, which already
reflects every result so far this season. Applying `matchEloDelta` on top counts the same form
twice, and the effect grows with how often ratings are refreshed.

Fitting the weight as a free coefficient (option C in `engine/src/fitting`) finds it neither
significant nor useful:

| Test | Result |
|---|---|
| Likelihood-ratio, drift coefficients jointly zero | χ²(2) = 4.11, p = 0.13 |
| Implied weight, home / away | 0.145 / 0.401 — mutually inconsistent, both far below `1` |
| Walk-forward, 152 matchday origins | drift **cost** 0.00085 log-likelihood per match |

The lambda defaults above were also fitted with no drift applied, so a non-zero weight feeds
the model an input distribution it was not estimated on.

Drift remains a live setting. Re-enabling it is coherent if the base Elo is a season-start
snapshot rather than a clubelo refresh — that is the configuration it was designed for.

Within a season simulation, Elo deltas apply after each match, but the form used for lambdas is refreshed on a matchday boundary so matches on the same matchday share start-of-matchday effective Elo.

## Season simulation

`simulateSeason`:

1. Start from fixtures and optional locked results
2. For unlocked fixtures, draw Poisson scorelines using current effective Elo and settings
3. For locked fixtures, replay stored goals
4. Apply Elo updates as matches resolve
5. Return a complete set of scorelines for the season

Interactive paths (`SeasonRunner`) can simulate one match, one matchday, or the rest of the season, skipping already-played (and respecting locked) fixtures.
