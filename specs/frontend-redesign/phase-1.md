# Phase 1 — Lead with the forecast

Highest impact per unit of risk. Almost no logic changes: a different landing view, visible
navigation, a derived summary, a mobile reflow, and the accessibility floor.

## Goals

- The first screen answers "who wins, who goes down, how confident".
- All three views are visible at once.
- The finishing-position distribution survives below 640px.
- Keyboard and screen-reader users can operate the app.

## Out of scope

Matchday navigation, empty-state copy, relocating run settings, typography, crests, light theme.
Those are Phases 2 and 3.

---

## 1.1 Land on Projections

| File | Change |
|------|--------|
| `web/src/App.tsx:72` | `useState<AppView>('consensus')` → `'projections'` |

Applies to both modes. Public mode already loads the projection during bootstrap
(`App.tsx:129-143`), so no extra fetch.

If no prediction exists, the existing `emptyProjectionMessage` renders. Leave its copy alone —
Phase 2 rewrites empty states.

## 1.2 Default consensus mode to `outcome`

The all-draws table is caused by `scoreline` mode taking the modal scoreline per fixture, which is
`1 – 1` for most matches. `outcome` picks the most likely result first, which produces a table a
reader can trust.

| File | Change |
|------|--------|
| `engine/src/engine/consensus.ts:8` | `DEFAULT_CONSENSUS_MODE: ConsensusMode = 'outcome'` |

Notes:

- This is the only engine change in the redesign. It is a default, not a behaviour change: the
  three modes and their maths are untouched.
- Predictions already in the database keep their persisted `consensusMode`. Only batches created
  after the change default to `outcome` (`engine/src/db/repository.ts:544`).
- The mode switch stays available to users. Phase 2 moves it out of the `⋮` menu.
- `engine/tests/repository.test.ts:280` exercises all three modes explicitly and does not assert
  the default, so no test should need editing. Confirm rather than assume.

## 1.3 Rename the consensus view

`Predictions` is the label for a view that shows one representative season, while `Projections`
shows the actual prediction. The names are backwards relative to what they contain.

| File | Change |
|------|--------|
| `web/src/lib/appView.ts` | `APP_VIEW_LABELS.consensus`: `'Predictions'` → `'Consensus'` |
| `web/src/lib/viewHelpContent.ts` | Update the consensus entry's title and any copy naming the view |
| `specs/web.md` | Update the view table's `consensus` label |

The `AppView` union member stays `'consensus'`; only the display label moves.

## 1.4 Replace the view dropdown with a tab bar

`web/src/components/ViewSwitcher.tsx` currently renders a button plus a dropdown listing only the
views you are not on. Replace the whole component body with a segmented control.

Requirements:

- Render every view from `getAppViews(publicMode)`, current one included and marked selected. Do
  not hardcode a tab count or fixed widths — Phase 2 §2.6 makes `results` public, taking the public
  tab bar from two items to three.
- `role="tablist"` on the container, `role="tab"` + `aria-selected` on each button.
- Left/Right arrow keys move between tabs; Home/End jump to first/last. Roving `tabIndex` so the
  group is a single tab stop.
- Delete the `open` state, the outside-click and Escape listeners, and the `rootRef`.
- Remove `.view-switcher-dropdown`, `.view-switcher-item`, `.view-switcher-chevron` and
  `.view-switcher-open` from `web/src/styles/app.css`.

Mobile labels: three full labels do not fit at 375px alongside the title and two icon buttons.
Add to `web/src/lib/appView.ts`:

```ts
export const APP_VIEW_SHORT_LABELS: Record<AppView, string> = {
  consensus: 'Season',
  projections: 'Odds',
  results: 'Results',
};
```

`Header.tsx` already branches on `useMediaQuery(MOBILE_QUERY)`; pass a `short` prop through to
`ViewSwitcher` in the mobile branch. When short labels are used, each tab keeps its full label as
`aria-label` so assistive tech is unaffected.

## 1.5 Projection headline strip

New component: `web/src/components/ProjectionHeadline.tsx`.

Pure presentation derived from props already in `ProjectionsView` — no API change, no new
endpoint, no engine work.

```ts
interface Props {
  projections: TeamSeasonProjection[];
  runs: number;
  nextMatchday: number | null;
  teams?: Team[];          // for short codes
}
```

Content — three cards plus a provenance line:

| Card | Source | Rule |
|------|--------|------|
| Title race | `titleProbability` | Top 3 descending; leader gets larger type |
| Top four | `championsLeagueProbability` | Top 5 descending, so the team on the bubble is visible |
| Relegation | `relegationProbability` | Top 3 descending |

Provenance line: `{runs.toLocaleString()} seasons simulated · MD{nextMatchday} next`, or
`· season complete` when `nextMatchday` is null. Mirror the wording already in `Header.tsx:60-67`.

Formatting reuses the existing `formatProbability` rule from `ProjectionsTable.tsx` (`—` at zero,
`<0.1%` below 0.001, one decimal otherwise). Lift it to `web/src/lib/formatProbability.ts` and
import it in both places rather than duplicating.

Rendering:

- Rendered by `ProjectionsView` above `ProjectionsTable`.
- Renders `null` when `projections` is empty.
- Desktop: three cards in a row, filling the dead vertical space currently below the table.
- Mobile: stacked, above the card list from 1.6.

`nextMatchday` is computed in `App.tsx:169` and currently passed only to `Header`. Thread it
through `ProjectionsView` as well.

## 1.6 Mobile card layout for projections

At 375px `ProjectionsTable` is a 10-column horizontal scroll; the `Finishing positions` column —
the most valuable thing on the screen — is entirely off-viewport.

New component: `web/src/components/ProjectionCardList.tsx`. `ProjectionsTable` branches on
`useMediaQuery(MOBILE_QUERY)` and delegates; the desktop table is unchanged.

Card anatomy, one per team:

1. Rank, short code, full name.
2. `PositionDistributionBar` at full card width.
3. Title / Top 4 / Rel percentages as three labelled figures.
4. Collapsed detail — Avg Pts, Avg Pos, GF, GA — behind a per-card disclosure
   (`<button aria-expanded>`), collapsed by default.

Sorting: there are no column headers to click, so add a `<select>` above the list bound to the
same `SortKey` union and comparators that `useSortableTable` already uses. Default
`averagePosition` ascending, matching the table.

## 1.7 Accessibility floor

Verified gaps. All are small and independent.

**Focus visibility.** `web/src/styles/app.css` has no `:focus-visible` rule anywhere; only two
`outline` declarations exist (lines 338, 728) and neither is a focus style. Add a `--focus-ring`
token and one global rule covering `button`, `a`, `input`, `select`, `[tabindex]`. It must be
visible against both `--bg` and `--bg-elevated`.

**Dialog semantics.** None of the five modals set `role="dialog"`, `aria-modal`, or a label, and
none trap or restore focus. `TeamRatingsModal` and `MonteCarloModal` additionally do not close on
Escape, while the other three do.

Add `web/src/components/Modal.tsx`:

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the modal's own title.
- Focus moves to the dialog on open and returns to the invoking element on close.
- Focus is trapped within the dialog while open.
- Escape and backdrop click both close, via an `onClose` prop.
- `MonteCarloModal` opts out of Escape and backdrop dismissal while a run is in flight — it
  already guards this in `App.tsx:462-464`; the guard moves into the `onClose` it passes.

Refactor onto it: `MonteCarloModal`, `TeamRatingsModal`, `PredictionManagerModal`,
`MatchDistributionModal`, `ViewHelpModal`. Each keeps its own body markup; only the shell moves.

**Sortable headers.** `web/src/components/SortableTh.tsx:28` is a `<th onClick>` — not reachable
or operable by keyboard. Wrap the label and indicator in a `<button type="button">` filling the
cell. Keep the existing `aria-sort` on the `<th>`; it is already correct.

**Toasts.** `App.tsx:374-384` renders both toasts as `<div onClick>` with the literal text
`(click to dismiss)`. Replace with `role="status"` (`aria-live="polite"`), a real close button
carrying `aria-label="Dismiss"`, and drop the instructional suffix. Success toasts auto-dismiss
after 4s; error toasts persist until dismissed.

---

## Acceptance criteria

- [ ] Both modes open on Projections.
- [ ] A new Monte Carlo batch defaults to `outcome` consensus; existing batches keep their stored
      mode; all three modes remain selectable.
- [ ] All three views (two in public mode) are visible and reachable in one click; the current one
      is visually and programmatically marked selected.
- [ ] The tab bar is fully operable by keyboard with arrow keys, and is one tab stop.
- [ ] The headline strip states title, top-four and relegation leaders with probabilities, plus
      run count and next matchday; it renders nothing when no projection is loaded.
- [ ] At 375px the projections view shows no horizontal scrollbar and every team's distribution
      bar is visible without scrolling sideways.
- [ ] Every interactive element shows a visible focus ring on keyboard focus.
- [ ] Every modal: announces as a dialog, traps focus, restores focus on close, closes on Escape
      and backdrop click — except `MonteCarloModal` during a run.
- [ ] Column sort can be triggered from the keyboard.
- [ ] Toasts announce politely and are dismissed with a button; success toasts self-dismiss.
- [ ] Public build still hides `results` and performs no API calls.

## Verification

```bash
cd engine && npm test
```

```bash
cd web && npm run typecheck
```

Manual pass, private mode at 1280px and 375px: land on Projections, tab to each view with the
keyboard only, open and close each modal with Escape, confirm focus returns to the button that
opened it. Repeat against a `VITE_APP_MODE=public` build.

## Risks

- **Changing the engine default touches shared code.** Contained to one constant, but re-run
  `engine` tests rather than trusting the diff.
- **Focus trapping regressions.** The five modals currently manage their own Escape handling in
  three different ways; migrating them to one shell is where a mistake would hide. Refactor them
  one at a time.
- **Landing on Projections when no batch exists** shows an empty screen to a first-time private
  user. Acceptable for one phase — Phase 2 replaces it with a real empty state — but if it grates,
  fall back to `consensus` when `listPredictions` returns nothing.
