# Frontend redesign

Phases 1 and 2 have shipped; their outcomes are folded into [../web.md](../web.md), and the phase
documents are kept as the record of why each change was made. Phase 3 is still a plan.

| Phase | Theme | Doc | Status |
|-------|-------|-----|--------|
| 1 | Lead with the forecast; make navigation and focus visible | [phase-1.md](phase-1.md) | **shipped** |
| 2 | Fix the mental model: run settings, discoverability, empty states | [phase-2.md](phase-2.md) | **shipped** |
| 3 | Craft: typography, crests, distribution scale, light theme | [phase-3.md](phase-3.md) | planned |

## Problem statement

The UI is dense and correct but leads with its least legible artifact. The default view is the
consensus season, which in `scoreline` mode collapses to `1 – 1` on most fixtures and produces a
table where clubs record 30+ draws. The Monte Carlo projection — probabilities and finishing
distributions, the thing the engine exists to compute — is one dropdown click away, and its best
visual is invisible below 640px.

Secondary problems: three top-level views hide behind a dropdown that shows only the two you are
not on; run parameters are presented as live controls in a header menu; the per-view help modal
enumerates six interactions that have no visible affordance.

The Results view has a third problem — it has outlived its purpose. See the decision below.

## Decision: the Results view goes read-only

Recorded in full at [phase-2.md](phase-2.md) §2.6. Summarised here because it changes what the app
is, not just how it looks.

Manual score entry predates the results sync. Now that `npm run week` and `npm run fetch:results`
pull results from fixturedownload — authoritatively, overwriting any local divergence — every edit
the UI offers is redundant, unstable, or actively obstructive: a hand-entered score that disagrees
with the remote halts the weekly loop until someone passes `--force`.

The **view** keeps its place; the **editing** does not. Results becomes read-only and is unhidden
in public mode, where the real table is currently unreachable. The redundant
`actual-results-state.json` export is dropped.

This is the only part of the redesign that removes a capability. Everything else is additive.

## Principles

1. **Lead with the answer.** Probabilities first, tables second, raw fixtures third.
2. **Controls live next to what they change.** A parameter that only affects the next Monte Carlo
   run belongs in the Monte Carlo modal, not in a header menu styled like a live filter.
3. **The help modal is a bug report.** Every bullet it needs is an affordance the UI is missing.
4. **Mobile shows the same information, not a subset.** Reflow, do not horizontally scroll.
5. **No new runtime dependencies.** Charts stay hand-rolled (`Sparkline.tsx`,
   `PositionDistributionBar.tsx`); no charting or component library.

## Constraints that apply to every phase

- Both builds must keep working: private (`npm run dev`, live API) and public
  (`VITE_APP_MODE=public`, static JSON, `results` view hidden, mutations no-op).
- No changes to the engine's match model, aggregation, or persistence. Two engine changes are
  sanctioned, both narrow: Phase 1 flips one default constant, and Phase 2 deletes an exported
  snapshot file that no client reads. Nothing else in `engine/` may move for presentation reasons.
- Existing domain invariants in [../invariants.md](../invariants.md) are untouched by all three
  phases.
- Per phase: `cd web && npm run typecheck` and `cd engine && npm test` both clean.
