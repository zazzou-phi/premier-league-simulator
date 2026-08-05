# Phase 3 — implementation plan

[phase-3.md](phase-3.md) is the spec: what changes and why. This is the execution plan against the
code as it stands after Phase 2 (`39797aa`) — commit sequencing, the sites each item actually
touches, and the three places the spec has drifted from the code since it was written.

Read this alongside the spec, not instead of it. Where the two disagree, the drift section below
says which one is right.

---

## Drift from the spec

### D1. The Elo edit affordance is already gone

3.5 lists "Elo values are editable with no affordance". They are not editable.
`TeamRatingsModal.tsx:122-124` renders Elo as a plain `<td>`, and the modal has no write path —
no input, no handler, no `api` call. **Drop the row from 3.5.** Nothing to do.

### D2. The zone legend does not repeat

3.5 lists "`zone-legend` repeats under every table". It does not. `LeagueTable.tsx:254-261` renders
one legend, and only two views mount a `LeagueTable` — `ConsensusView.tsx:101` and
`ActualResultsView.tsx:109`, one instance each. The two real defects are different:

- The legend is the last child of `.league-table`, which sits inside the `.standings-scroll`
  scroller (`app.css:456-468`). It is below twenty rows, so it is off-screen exactly when a reader
  hits a colour they cannot decode.
- **Projections has no legend at all.** `ProjectionsView` renders no `LeagueTable`, but
  `PositionDistributionBar` colours every segment by the same four zones
  (`PositionDistributionBar.tsx:29-35`). The one view whose primary visual is entirely
  colour-encoded is the one view with nothing explaining the colours.

**Re-scope the item:** move the legend into the `LeagueTable` title row (the `titleActions` area
Phase 2 added), and give `ProjectionsView` a legend beside the 3.3 axis.

### D3. 3.2 step 3 is not covered by the engine-change budget

The plumbing is already there: `crest` is on the schema (`db/schema.ts:8`), read back by the
repository (`db/repository.ts:95`), and present on the `Team` the API returns
(`engine/src/engine/types.ts:7`). So steps 1–2 need no engine change at all — `TeamBadge` can read
`team.crest` today and always get `null`.

Step 3 is the problem. `data/teams.csv` has no crest column and `data/teamsCsv.ts:49` hardcodes
`crest: null`, so populating crests means a CSV column, a parser change, and a decision about how
the public export ships the images. [README.md](README.md) sanctions exactly two engine changes
across the redesign, and Phases 1 and 2 have spent both.

**Step 3 is out of scope for this plan.** It needs its own sanction and its own licensing decision.
Steps 1–2 ship without it, as the spec itself allows.

### D4. Bonus finding for 3.3 — the 641–900px dead band

The distribution column is hidden at `max-width: 900px` (`app.css:1747-1753`), but the card list
that replaces it only takes over at `MOBILE_QUERY`, which is 640px (`lib/useMediaQuery.ts:19`).
Between 641px and 900px the reader gets neither: the table renders without its distribution column
and no card list stands in. Fix it in the same commit as 3.3.

---

## Commit sequence

Five commits. C1 lands alone because it touches every screen; C5 lands last so the colour sweep
happens once, against the final set of surfaces.

| # | Item | Scope |
|---|------|-------|
| C1 | 3.1 Typographic split | `app.css`, near-zero TSX |
| C2 | 3.5 Corrections (minus D1, D2 re-scoped) | `App.tsx`, `MonteCarloModal`, `TeamRatingsModal`, `LeagueTable`, `ProjectionsView` |
| C3 | 3.2 `TeamBadge`, steps 1–2 | New component + 5 call sites |
| C4 | 3.3 Distribution axis + D4 | `PositionDistributionBar`, new axis component |
| C5 | 3.4 Light theme | `app.css`, `Header`, new theme hook |

### C1 — Typographic split

`:root` currently sets the mono stack and 13px for the whole app (`app.css:21-24`).

Add `--font-ui` and `--font-mono` tokens, point `:root` at `--font-ui`, and raise the base to 14px.
The numeric surfaces all have their own selectors already, so mono is opted back in from CSS —
**no TSX changes are needed for this commit**:

`.league-table td` (with `td.league-table-team` overridden back to UI face), `.projections-table td`
(same override for `td.projections-team`), `.ratings-table-numeric`, `.score-display`,
`.fixture-prefix`, `.headline-pct`, `.projection-card-rank`, `.projection-card-figure dd`,
`.sim-id`, `.upset-factor-value`, `.monte-carlo-progress-header`, `.accuracy-table td`,
`.accuracy-metric-value`, `.diverging-axis`, `.header-matchday`.

`font-variant-numeric: tabular-nums` is already on `.league-table th,td` (`app.css:523`),
`.projections-table th,td` (`app.css:1538`) and `.ratings-table-numeric` (`app.css:1227`). It is
**missing** from `.accuracy-table` and `.score-display` — add it there.

**The audit item is bigger than the spec states.** The spec expects hardcoded character-cell
widths. There are none — but `:root { font-size }` is the rem basis, so 13px → 14px rescales every
rem dimension in the file by 7.7%. The regression sites are the boxes sized to fit specific
content:

| Site | Why it is at risk |
|------|-------------------|
| `app.css:21` `--fixture-row-max-width: 44rem` | Caps the fixture row; grows to ~47.4rem-equivalent |
| `app.css:391` `grid-template-columns: fit-content(46rem)` | Sized to the full P/W/D/L/GF/GA/GD/Pts set |
| `app.css:794,1725,1882` `.fixture-row` 6.75/5.5/4.75rem prefix column | Sized to the mono kickoff string, which is about to get narrower |
| `app.css:1157` `.sim-row` 3rem/6rem tracks | Comment says the 6rem fits "10,000 runs" |
| `app.css:864,1876,1898` `.score-display` min-widths | Sized to `10 – 10` |
| `app.css:2031` `.spark-empty` 72px | Must match `Sparkline`'s px width, not rem |

Two notes while in the file:

- The mobile breakpoint sets `:root { font-size: 15px }` (`app.css:1757`), so the mobile scale is
  unaffected by the desktop bump and mobile screenshots should be diffed separately.
- `.btn.header-icon-btn` is `2.75rem` (`app.css:326-331`), which is 35.75px at today's 13px root
  and 38.5px at 14px — both under the 44px touch minimum the rule was presumably written for.
  Switch it to px. This is a pre-existing bug, not a regression; call it out in the commit message.

### C2 — Small corrections

| Item | Site | Change |
|------|------|--------|
| Header repeats the run count | `App.tsx:366-370` | `activePredictionLabel` appends `· N runs` unconditionally, and the default name from `MonteCarloModal.tsx:66` is `Monte Carlo {runs}` — so the default case always double-prints. Append the suffix only when the name does not already contain the formatted count |
| Ratings modal clips its last row | `app.css:1195-1198` | `.ratings-table-wrap` is a flat `max-height: 400px`; with a 20-row table it always cuts mid-row. Use a row-multiple max-height and add a scroll shadow |
| `Number of seasons` is a bare input | `MonteCarloModal.tsx:78-91` | Add 1k / 5k / 25k presets beside the input. For the estimate: `result.elapsedMs` is already in hand (`MonteCarloModal.tsx:186`) — persist ms-per-run from the last completed run to `localStorage` and show a projected duration under the input. Absent a stored figure, show nothing rather than a guess |
| Zone legend (per D2) | `LeagueTable.tsx:254-261`, `ProjectionsView.tsx` | Extract the legend into its own component; render it in the `LeagueTable` title row and once in `ProjectionsView` |
| Elo edit affordance | — | Dropped, per D1 |

### C3 — `TeamBadge` (steps 1–2)

New `web/src/components/TeamBadge.tsx`. Renders `team.crest` when present, falling back to the
short-code chip. With every crest null the output is identical to today's markup, which is what
makes this commit safe.

Five call sites currently duplicate the chip markup:

| Site | Current |
|------|---------|
| `LeagueTable.tsx:208` | `<span className="league-table-short">` |
| `ProjectionsTable.tsx:129-130` | same class |
| `ProjectionCardList.tsx:74` | same class |
| `ProjectionHeadline.tsx:70-71` | same class |
| `FixtureList.tsx:227,249` | `<span className="fixture-team-short">` |
| `TeamRatingsModal.tsx:120` | bare `{team.shortName}` in a Code column |

`ProjectionsTable`, `ProjectionCardList` and `ProjectionHeadline` each build their own
`shortNameById` map (`:33-34`, `:23-24`, `:41-42`) because a `TeamSeasonProjection` carries only
`teamId` and `teamName`. `TeamBadge` needs the whole `Team` to reach `crest`, so collapse the three
maps into one shared `teamsById` lookup returning `Team | undefined`, and let the badge fall back to
the projection's `teamName` when the team is missing. `FixtureList` already has full `Team` objects
on `match.teamHome` / `match.teamAway` — no lookup needed there.

With the chip centralised, resolve the `CODE Full Name` duplication in one place: code only at
≥1024px in the wide tables, name only elsewhere.

### C4 — Distribution axis

Rewrite `PositionDistributionBar.tsx`. Today it drops zero-count positions and sets
`flexGrow: count` (`:26-38`), which gives every row its own horizontal axis and puts the only
readout in a `title` attribute that touch never surfaces.

- Fixed 20-slot axis; frequency encodes as segment height or opacity, not width.
- Shared `PositionAxis` ruler with ticks at 1, 4, 5, 17, 20 — once at the top of the
  `Finishing positions` column on desktop, once above the card list on mobile.
- P10/P90 ticks computed in the component from `positionCounts`.
- Readout on hover *and* tap: `Nth: 1,234 (24.7%)`. Keep the `role="img"` + `aria-label` summary
  (`:21-25`) untouched for screen readers.
- Close the D4 dead band: align the CSS hide breakpoint with `MOBILE_QUERY`, or switch
  `ProjectionsView.tsx:27` to a 900px query so cards take over exactly where the column drops.

Still CSS and inline SVG — no charting dependency, consistent with `Sparkline.tsx`.

### C5 — Light theme

`app.css:2` hardcodes `color-scheme: dark` and every token is dark-only.

**Tokenise first.** Beyond the documented palette, these are hardcoded and would survive a token
swap unchanged:

| Site | Value |
|------|-------|
| `app.css:101` `.app-toast` | `#3d1f1f` |
| `app.css:119` `.app-toast-success` | `#1a3d2a` |
| `app.css:351` `.btn-simulate` | `color: #0d1117` |
| `app.css:608` `.team-selected td` | `rgba(255, 200, 50, 0.15)` |
| `app.css:188` `.header-dropdown-panel` | `box-shadow … rgba(0,0,0,0.4)` |
| `app.css:937` `.modal-overlay` | `rgba(0,0,0,0.75)` |
| `app.css:1698` `.outcome-bar-segment-actual` | `color-mix(… white 75%)` |

**Then the palette.** Dark stays the default look; the choice becomes explicit via a `:root` set
plus a `prefers-color-scheme` override, with a `:root[data-theme]` escape hatch that wins in both
directions. Toggle goes in the `More` menu (`Header.tsx:73-97`) and persists to `localStorage` —
not the settings API, which is private-mode only and would leave the public build without a toggle.
Nothing in `web/src` uses `localStorage` today, so this introduces the first use; a small
`useTheme` hook keeps it in one place.

**The data colours need new values.** Measured contrast, current tokens:

| Token | Value | on `--bg` `#0d1117` | on `#ffffff` |
|-------|-------|--------------------|--------------|
| `--zone-champion` | `#d29922` | 7.50 | **2.52** |
| `--zone-champions-league` | `#58a6ff` | 7.49 | **2.53** |
| `--zone-europa` | `#39c5cf` | 9.07 | **2.09** |
| `--zone-relegation` | `#f85149` | 5.65 | **3.35** |
| `--green` | `#3fb950` | 7.45 | **2.54** |

All five fail 3:1 on a light surface except relegation, which only just clears it and would fail
against an elevated `#f6f8fa`. Recommended light counterparts — the GitHub light semantic set,
which is a coherent family and already checked for the common colour-vision deficiencies:

| Token | Light value | on `#ffffff` | on `#f6f8fa` |
|-------|-------------|--------------|--------------|
| `--zone-champion` | `#9a6700` | 4.87 | 4.57 |
| `--zone-champions-league` | `#0969da` | 5.19 | 4.88 |
| `--zone-europa` | `#1b7c83` | 4.93 | 4.63 |
| `--zone-relegation` | `#cf222e` | 5.36 | 5.03 |
| `--green` | `#1a7f37` | 5.08 | 4.77 |

Contrast is checked above; **distinguishability under CVD is not**, and a ratio will not catch it.
Verify the four zone colours separately against deuteranopia and protanopia before shipping — they
are the only colours in the app that encode data.

---

## Acceptance criteria

Inherited from [phase-3.md](phase-3.md), plus:

- [ ] The zone legend is readable without scrolling the standings, and Projections has one.
- [ ] No viewport width shows the projections table without a distribution and without the card
      list standing in.
- [ ] The default projection name no longer prints its run count twice in the header.
- [ ] `data/teams.csv` and `engine/` are untouched by every commit in this plan.

## Verification

Per commit:

```bash
cd web && npm run typecheck
```

No `engine/` change is planned, so `npm test` runs once at the end as a guard, not per commit.

Screenshot matrix before and after C1: every view × {1280, 375} × {light, dark}. The private build
needs both servers:

```bash
cd engine && npm run api
```

```bash
cd web && npm run dev
```

After C5, confirm the public build stays self-contained — build with `VITE_APP_MODE=public` and
load it with devtools filtered to third-party origins. This matters more once crests land (D3), but
check it now to establish the baseline.

## Risks

- **C1 rescales the whole layout, not just the type.** The 7.7% rem bump is the actual risk, not
  the face change. Diff the six sites in the C1 table specifically; a screenshot pass that only
  looks at text will miss a fixture row that gained a wrapped column.
- **C4 changes what the bars mean.** Fixed-axis bars are not comparable to the proportional-width
  bars anyone has read before. Say so in the release note, as the spec asks.
- **C5's toggle is the first `localStorage` use in the app.** Public and private builds share it;
  make sure a corrupt or absent value falls back to the media query rather than throwing at mount.
- **D3 leaves 3.2 half-finished by design.** `TeamBadge` ships rendering short codes forever until
  crest sourcing gets its own decision. That is the spec's intent, but it means the acceptance
  criterion "with all crests null, the UI is visually unchanged" is the *permanent* state after this
  plan, not a transitional one.
