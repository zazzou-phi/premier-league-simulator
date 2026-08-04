# Phase 2 — Mental model and discoverability

> **Shipped.** Kept as the record of the decisions, in particular §2.6. Current behaviour is
> documented in [../web.md](../web.md).

Phase 1 fixed what you see first. Phase 2 fixes what the controls appear to promise, and removes
the need for the help modal to explain the interface.

Depends on Phase 1 (tab bar, `Modal` shell, focus styles).

## Goals

- No control is presented as live when it only affects the next simulation run.
- No control writes data the results sync will silently overwrite.
- Every interaction listed in the help modal has a visible affordance.
- 380 fixtures are navigable.
- Empty states say what to do next instead of showing twenty rows of zeros.
- Projected and actual tables are distinguishable at a glance.

## Out of scope

Typography, crests, distribution-bar axis, light theme — all Phase 3.

---

## 2.1 Run parameters move into the Monte Carlo modal

**The problem.** Upset factor and Season form sit in the header `⋮` menu (`Header.tsx:98-131`),
styled as live sliders. They change nothing on screen. Both are read only at simulation time —
`engine/src/api/app.ts:199,221`, `engine/src/simulation/runner.ts:54`,
`engine/src/monte-carlo-cli.ts:42`, `engine/src/week-cli.ts:179`. Upset factor is additionally
duplicated inside `MonteCarloModal`, bound to the same persisted setting, so the same value
appears in two places with two different framings.

**The change.**

| File | Change |
|------|--------|
| `web/src/components/Header.tsx` | Remove `UpsetFactorControl` and `SeasonFormControl` from the options menu, and the `upsetVariance` / `seasonEloDeltaWeight` / `onChange` props that feed only them |
| `web/src/components/MonteCarloModal.tsx` | Host both controls under a `Run parameters` heading |
| `web/src/App.tsx` | Keep the state and the persisting handlers; pass them to the modal only |

Both remain persisted settings written through the existing endpoints on change — do not switch
them to per-run request fields. The API reads `seasonEloDeltaWeight` server-side from settings
(`app.ts:199`) while `upsetVariance` is accepted from the request body (`app.ts:185`); preserving
the write-on-change behaviour keeps that asymmetry harmless. If a season-form change is still
in flight when Run is pressed, await it before issuing the run.

Add to the modal, next to the heading: a `Reset to defaults` control, enabled only when either
value differs from `DEFAULT_UPSET_VARIANCE` / `DEFAULT_SEASON_ELO_DELTA_WEIGHT`. This replaces the
`settingsChanged` dot currently on the header button (`Header.tsx:86-88`).

The existing hint strings (`UPSET_FACTOR_HINT`, `SEASON_FORM_HINT`) are good and stay, now with
room to be shown in full rather than in a cramped dropdown.

## 2.2 Consensus mode moves next to the table it controls

`Consensus scorelines` is a property of the consensus table, currently three buttons in a header
menu two levels away from it.

Move the segmented control into the `LeagueTable` title row of `ConsensusView`, beside
`Consensus table` / `{matchesPlayed}/{matchesTotal} played`. Keep `CONSENSUS_MODE_HINT` as the
accessible description.

`LeagueTable` should not learn about consensus modes. Give it an optional `titleActions?: ReactNode`
slot rendered in `.league-table-title`, and let `ConsensusView` pass the control in. `ActualResultsView`
passes nothing.

Retain the `savingConsensusMode` disabled state and the success toast from `App.tsx:239-254`.

## 2.3 The options menu becomes stable

After 2.1 and 2.2 the `⋮` menu holds only navigation: `Team Ratings` and `Manage Projections`. In
the Results view it holds exactly one item, and its contents change per view — muscle memory
breaks between views.

- Show the same two entries in every view, in the same order.
- `Manage Projections` is disabled with a title explaining why, rather than absent, in public mode
  and in the Results view.
- Label the trigger `More` with a visible caret rather than a bare `⋮` glyph. It keeps its
  `aria-label`.

## 2.4 Fixture list navigation

`FixtureList` renders up to 380 rows grouped by matchday with no way in: no jump, no filter, no
anchor, no search.

- **Sticky matchday bar.** The `.matchday-header` is already sticky in CSS. Add a control row
  above the list: `‹ prev` / `Matchday N` / `next ›`, plus a `<select>` listing every matchday for
  direct jump. Scrolling updates the label to the matchday currently at the top of the viewport.
- **Anchor on load.** Scroll to the next unplayed matchday on mount instead of matchday 1. `App.tsx:169`
  already computes `nextMatchday` from `findNextMatchday`; thread it into `FixtureList` as
  `initialMatchday`. Do not re-anchor on every re-render — only on mount and when the prediction
  changes.
- **Team filter is already correct** (`filterTeamLabel` + `Clear filter`, `FixtureList.tsx:79-93`).
  Leave it; 2.5 makes the way to *set* it discoverable.

## 2.5 Affordances the help modal currently substitutes for

`ViewHelpModal` lists six interactions. Each is a missing affordance:

| Help bullet | Fix |
|-------------|-----|
| "Click a fixture to open its distribution" | The score button is already a `<button>`; give it a hover/focus affordance and a `title`/`aria-label` naming the action ("Outcome distribution: Arsenal vs Coventry"). Add a chevron on hover at ≥640px. |
| "Click a club in the table to filter" | Row hover state exists (`app.css:560`) but reads as decoration. Add a filter glyph in the team cell on hover/focus, and make the row keyboard-activatable — a `<button>` in the team cell, not a click handler on `<tr>`. |
| "On mobile, switch panels with the tabs" | The tabs are visible; drop the bullet. |
| "Change the consensus mode in the ⋮ menu" | Fixed by 2.2; drop the bullet. |
| "Run Monte Carlo to build a projection" | Keep — it describes a concept, not a hidden control. |
| "Use Manage Projections in the ⋮ menu" | Fixed by 2.3; reword without the menu path. |

Trim `web/src/lib/viewHelpContent.ts` accordingly. The `About` tab, which explains the model, is
the part worth keeping and should not shrink.

## 2.6 Results becomes read-only, and public

Manual score entry predates the results sync. It is no longer on the normal path, and it now
works against the pipeline.

**Why the editing goes.** `npm run week` syncs results as step 1 before anything else
(`engine/src/week-cli.ts:103-126`), and `npm run fetch:results` does it standalone. The sync is
authoritative and one-directional: it iterates the *remote's* completed results and overwrites any
local divergence (`engine/src/data/syncResults.ts:50-72`). So every edit made in the UI is either
redundant or unstable:

| Action in the Results view | What the next sync does |
|----------------------------|-------------------------|
| Enter a score matching the remote | Counts it `unchanged` — the edit bought nothing |
| Enter a score the remote disagrees with | Silently overwrites it |
| Clear a recorded result | Re-applies it; `existing` is undefined, so it counts as newly `applied` |

Worse, the second row jams the weekly loop. `week` previews the sync and refuses to proceed when
`overwritten > 0`, printing a warning about silently rewriting history, until `--force` is passed
(`engine/src/week-cli.ts:108-117`). It cannot distinguish a provisional hand-entered score from a
genuine remote correction, so a manual entry blocks the automation until someone reads the error.

What manual entry uniquely retains is thin: a few hours' lead over fixturedownload, and an
override of a bad remote value that the next sync reverts anyway. A durable override needs a
pinned-manual flag in the schema that `syncActualResultsFromRemote` respects. That does not exist,
and this redesign does not add it — if remote errors turn out to be a recurring problem, spec it
separately as an engine change.

**What stays.** Showing what actually happened is still worth a view. It is currently hidden from
the audience that most wants it: `results` is filtered out in public mode
(`web/src/lib/appView.ts`), so public readers cannot see the real table at all.

**The change.**

| File | Change |
|------|--------|
| `web/src/components/ActualResultsView.tsx` | Drop `editingMatchNumber`, `onStartEdit`, `onSaveScore`, `onCancelEdit`, `onClearScore`, `readOnly`. Pass `allowEdit={false}` and drop `editRecordedResults` |
| `web/src/lib/appView.ts` | `getAppViews` returns all three views in both modes |
| `web/src/App.tsx` | Delete `handleSaveActualScore`, `handleClearActualScore`, and the `editingMatchNumber` state |
| `web/src/components/ScoreEditor.tsx` | `ScoreEditor` loses its last caller; `ScoreDisplay` stays. Delete the editor, keep the file |
| `web/src/components/FixtureList.tsx` | `onStartEdit` / `onSave` / `onCancelEdit` / `onClear` / `editRecordedResults` become unreachable. Remove them once no caller passes them |
| `web/src/lib/viewHelpContent.ts` | Results help drops "record and clear scores"; describes a read-only record |

Keep the `PUT` and `DELETE /api/v1/actual-results/:matchNumber` endpoints. The sync path calls
`repo.setActualResult` directly rather than over HTTP, so they lose their only client, but they are
tested, cheap, and leave a manual escape hatch via `curl`. Removing them is a separate decision.

**Stop exporting `actual-results-state.json`.** It is 326KB rewritten on every `week` run
(`engine/src/export/publicSnapshot.ts:115,125`) and nothing has ever fetched it —
`web/src/api/staticClient.ts` has no loader for it. It is also fully redundant:
`ActualResultsView` derives the same standings client-side from `bootstrap.actualResults` via
`computeLeagueStandings`, which is exactly what the newly-public view will keep doing. Redaction is
a no-op for it, since `redactUnrevealed` preserves every `locked` match
(`publicSnapshot.ts:62`) and actual results are locked by definition.

Drop `actualResultsState` from `PublicSnapshot` and `snapshotToFiles`, and update the file-set
assertion at `engine/tests/publicSnapshot.test.ts:119-125`. This is the one engine change in
Phase 2; it is a deletion, and it removes a file no client reads.

## 2.7 Empty and pre-season states

Three screens currently render twenty rows of zeros or 380 blank fixtures:

| State | Replacement |
|-------|-------------|
| Results view, pre-season | "No matches played yet. The season starts {first fixture date}." Suppress the all-zero table; keep the fixture list showing the opening matchday. No call to action — after 2.6 there is nothing for the reader to do here. |
| Projections/Consensus, no prediction | Keep the existing "Run a Monte Carlo batch" copy but make it actionable — a `Run Monte Carlo` button opening the modal directly. Public mode instead says the snapshot contains no projection. |
| Public snapshot, pre-season | The headline strip from Phase 1 carries the forecast, so the consensus table's zeros are no longer the first thing seen. Add "No matches played yet" in place of `0/380 played`. |

## 2.8 Distinguish projected from actual

The two views render the same two-panel layout with the same table and fixture list; only small
header text differs. After 2.6 they are both read-only, so the distinction that matters is no
longer "editor vs viewer" — it is **projected vs actual**, and that has to be unmistakable.

- Panel titles already differ (`Consensus table` / `Actual table`) — promote them: larger, with a
  one-line subtitle stating provenance ("Most likely result per fixture across N seasons" vs
  "Recorded scores only, synced from fixturedownload").
- The Results view gets a distinct accent on its panel headers, reusing an existing token rather
  than introducing a colour.
- Because both views are now read-only and structurally identical, note for a future phase that
  they are candidates to collapse into one Season view with a projected/actual toggle. Do not do
  it here — ship the read-only version and see how it is used first.

---

## Acceptance criteria

- [ ] Upset factor and Season form appear only in the Monte Carlo modal, with a working reset.
- [ ] Changing either persists immediately; a run started straight after a change uses the new value.
- [ ] Consensus mode is set from beside the consensus table; the toast and disabled state still work.
- [ ] The `More` menu shows the same entries in every view and mode; unavailable entries are
      disabled with an explanation, not hidden.
- [ ] The fixture list opens anchored on the next unplayed matchday and can jump to any matchday.
- [ ] A first-time user can, without opening help: open a fixture's distribution and filter the
      table by club.
- [ ] Filtering by club is possible with the keyboard alone.
- [ ] Help modal bullets that describe fixed affordances are gone; the `About` tab is unchanged.
- [ ] No screen shows an all-zero table as its primary content.
- [ ] Projected and actual tables are distinguishable from a screenshot of the panel area alone.
- [ ] No path in the UI writes or clears an actual result.
- [ ] The Results view is reachable in public mode and renders the real table from `bootstrap.json`
      alone.
- [ ] `actual-results-state.json` is no longer written; the snapshot is four files.
- [ ] `npm run week` completes without `--force` on a database that has only ever been synced.

## Verification

```bash
cd engine && npm test
```

```bash
cd web && npm run typecheck
```

Manual, private mode with an empty results set and again with results recorded: change upset
factor, run 200 seasons, confirm the new batch reflects it; jump to matchday 20 and back. Then
build public (`VITE_APP_MODE=public`) and confirm the Results view appears, shows the actual table,
and offers no editing control.

Snapshot check after the export change:

```bash
cd engine && npm run export:public && ls ../web/public/data
```

## Risks

- **2.1 changes `Header`'s props.** It is the most-connected component in the app; `App.tsx` is the
  only caller, so the blast radius is small but the diff will look large.
- **2.4 scroll anchoring** interacts with the mobile tab switch in `SeasonLayout` — the fixtures
  panel is unmounted-adjacent, not unmounted, so measure before scrolling or the anchor lands at 0.
- **2.6 removes a capability, not just an affordance.** If anyone relies on hand-entering a score
  before fixturedownload publishes it, this takes that away. The replacement is `npm run week` once
  the remote catches up. Confirm that is acceptable before starting — it is the one item in the
  redesign that is not purely additive.
- **2.6 prunes shared props.** `FixtureList` is used by both views; remove the edit props only
  after `ActualResultsView` stops passing them, or the consensus path silently keeps dead branches.
- **Deleting the export file is one-way for old snapshots.** A previously published site loading a
  cached `actual-results-state.json` is unaffected — nothing fetched it — but confirm no external
  consumer picked it up before deleting.
