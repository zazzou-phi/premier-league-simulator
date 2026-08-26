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

Effective Elo for simulation: `base + weight × delta`. **Weight default `1`**, allowed `0…5`
(`app_settings.season_elo_delta_weight`).

### Where each kind of result is priced in

Real results move the **base** rating. Simulated ones move the **drift** on top of it. Nothing
is counted in both places, and that boundary is the invariant to preserve:

| | Owner | When |
|---|---|---|
| Real results | `syncTeamRatingsFromResults` → `teams.elo` | The ratings step of `npm run week` |
| Simulated results | `matchEloDelta` → in-run drift | Every Monte Carlo run |

The ratings step recomputes `teams.elo` as `teams.anchor_elo` plus the Elo update implied by
every real result to date. It **recomputes rather than increments**, so running it twice is a
no-op and a corrected scoreline is absorbed rather than layered on top of the wrong one. The
anchor is the last rating from outside the model, pinned once and never overwritten.

The `team_elo_history` snapshot is keyed the same way — by the date of the last result priced
in, not by the day the sync ran — so an idle run adds no point and the series carries one entry
per round. See `specs/persistence.md`.

A batch projecting from matchday 12 therefore starts every club at a rating that already
reflects matchdays 1–11, and lets only 12–38 move it. Locked fixtures are banked into the
run's starting table and contribute no drift, because their effect is already in the number
the run starts from.

This is the arrangement clubelo used to provide — an externally refreshed base with
counterfactual drift on top — with the engine's own Elo update in place of the feed.
`api.clubelo.com` stopped answering on 22 August 2026 (see `specs/api.md`) and published no
replacement, so the base needed a new source rather than a new meaning. `--clubelo` opts back
into the old feed explicitly, so the rating source can never change mid-season by accident.

### What the frozen-anchor fit measures

`npm run fit:elo-k` freezes the base at each season's opening clubelo rating, lets drift be the
only in-season update, and scores the following matchday walk-forward across 2021/22–2025/26.
Because every candidate sees identical origins, the comparisons below are **paired** — origin
variance is large and common to all of them, so the ranking alone would prove nothing.

| Reference | Mean out-of-sample log-likelihood per match |
|---|---|
| Live clubelo, no drift — the pre-outage engine | −2.99066 |
| Frozen anchor, no drift — `--no-ratings` with drift off | −3.01321 |
| Headroom the feed was worth | 0.02256 |

| Paired comparison | Mean diff | SE | t |
|---|---|---|---|
| Drift vs no drift, at the best setting | **+0.02281** | 0.00594 | **3.84** |
| K = 25 vs K = 20 | +0.00088 | 0.00085 | 1.04 |
| Margin-of-victory (`log`) vs `none` | +0.00004 | 0.00082 | 0.04 |
| Margin-of-victory (`linear`) vs `none` | −0.00116 | 0.00147 | −0.79 |

Drift on real results recovers essentially the whole headroom: an anchor plus the Elo update
from real results *matches* the live feed over these five seasons. That is the evidence for
letting real results move the rating at all — the fit says the update is worth applying, and
the table above says where to apply it.

The same sweep declined two changes. K stays at 20 — 25 tops the raw ranking but at t = 1.04.
Margin-of-victory scaling stays off; `movMultiplier` implements `linear` and `log` schemes, and
neither is distinguishable from ignoring the margin. The likely reason is that the engine never
consumes Elo directly — it feeds a Poisson GLM on the rating gap, and margin information
already reaches the lambdas through the training data.

### Why the weight is 1

An earlier revision defaulted the weight to `0`, on this evidence:

| Test | Result |
|---|---|
| Likelihood-ratio, drift coefficients jointly zero | χ²(2) = 4.11, p = 0.13 |
| Implied weight, home / away | 0.145 / 0.401 — mutually inconsistent, both far below `1` |
| Walk-forward, 152 matchday origins | drift **cost** 0.00085 log-likelihood per match |

Those numbers are correct, and they measure a different thing. `rollingOriginEvaluation`
accumulates drift over real results *on top of a live clubelo base* and asks whether it sharpens
the next matchday. Since that base already contains those results, it is a test of whether to
double-count — and the answer is rightly no. `anchoredWalkForward` asks the question that
matters now, with the base frozen so drift is the only thing pricing form in, and gets the
opposite answer (t = 3.84). The two are consistent: the first says do not add drift to a live
feed, the second says drift can stand in for one.

The question drift actually answers is whether simulated **final tables** are as spread out as
real ones. Simulating full seasons at K = 20 from `data/teams.csv` (1,500 seasons per weight):

| weight | champion pts | 4th | 17th | 1st−20th spread | SD of points |
|---|---|---|---|---|---|
| 0.00 | 84.8 | 67.0 | 38.5 | 65.9 | 16.03 |
| 0.50 | 84.9 | 67.6 | 37.8 | 66.3 | 16.42 |
| **1.00** | **85.5** | **68.5** | **36.8** | **67.3** | **17.00** |
| 1.50 | 87.1 | 69.9 | 35.7 | 69.3 | 17.87 |
| 2.00 | 89.7 | 71.7 | 33.7 | 72.9 | 19.27 |

Against the five completed seasons (2021/22–2025/26), whose mean final table is champion 88.4,
4th 68.8, 17th 37.8, spread 69.4, **SD of points 17.97**:

- Weight `0` is under-dispersed by 1.99 points of SD — about 3.2 standard errors, given a
  season-to-season SD of 1.41 on n = 5.
- Weight `1` closes half the gap (1.5 SE remaining).
- Weight `1.5` matches almost exactly (0.25 SE) but is **not** the default: part of the residual
  gap is clubelo's pre-season ratings being shrunk toward the mean relative to realised
  end-of-season strength, and tuning drift to absorb a ratings artefact would be fitting a
  confound on five seasons.

Drift is close to zero-sum at the match level, so this costs nothing in the fit the lambdas were
estimated for: league H/D/A moves 44.2/22.3/33.5 at weight 0 to 43.8/22.5/33.7 at weight 1, and
goals per match 2.940 to 2.939. It mostly reshuffles *which* fixtures are mismatched. Mean
maximum drift at season end is 75 Elo at weight 0 against 104 at weight 1.

In short: calibrated to final-table dispersion, not to per-match likelihood.

Within a season simulation the delta applies after every match, so a club's later fixtures in a
matchday already see its earlier one.

## Season simulation

`simulateSeason`:

1. Start from fixtures and optional locked results
2. For unlocked fixtures, draw Poisson scorelines using current effective Elo and settings
3. For locked fixtures, replay stored goals
4. Apply Elo updates as matches resolve
5. Return a complete set of scorelines for the season

Interactive paths (`SeasonRunner`) can simulate one match, one matchday, or the rest of the season, skipping already-played (and respecting locked) fixtures.
