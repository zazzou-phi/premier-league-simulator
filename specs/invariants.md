# Invariants

Rules that must hold across features. Violating these breaks domain correctness or the public leak boundary.

## Match model

1. Two independent Poisson draws from fixed home/away baselines plus an Elo gap.
2. Each side's rate is its own log-linear function of the Elo gap, so the match total is deliberately *not* fixed: mismatches really are higher scoring (2.84 goals inside a 100-point gap against 3.37 beyond 300).
3. Raising upset variance must **not** inflate total expected goals (form multiplier is mean-rescaled).

## Monte Carlo persistence

4. Aggregate runs in memory. **Never** persist per-run fixture tables.
5. A saved prediction stores outcome/scoreline distributions, finishing histograms, team stat sums, and a small season reservoir (~50) for the `random` strategy.

## Actual results

6. Locked results are authoritative: simulations must not overwrite them.
7. A Monte Carlo run simulates only the unplayed remainder. Locked fixtures are banked into the starting table once per batch and re-attached afterwards as degenerate distributions, so a persisted batch still covers all 380 fixtures and carries no predictive content for the locked ones.
8. Recording an actual result writes only `actual_match_results`. Every read path overlays actuals over stored simulation rows; stored simulations are never rewritten.
9. Picked / prediction state always overlays actuals on top of chosen scorelines.

## Standings

10. Order is points → goal difference → goals for → name. No head-to-head mini-league, no penalties.

## Public export

11. Kickoff reveal: blank unrevealed predictions before publish.
12. Recompute the published table from revealed (and locked) matches only — standings must not imply future results.
13. Public build is static: no API, no SQLite.

## Data pipelines

14. Prefer real fixtures/ratings CSV pipelines over the circle-method generator except in tests that need a synthetic season.
15. Fixture set must remain a valid double round-robin: 380 matches, 19H/19A per team, unique pairings.

## Product boundaries

16. No World Cup group stage, knockout bracket, or penalty shootouts in PL mode.
17. Keep private (`VITE_APP_MODE` unset) and public (`public`) web behaviours distinct; do not assume API availability in the public site.
