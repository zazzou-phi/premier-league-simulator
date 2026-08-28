# Web UI

Stack: React 18, Vite 6. Engine types imported via `@shared` → `../engine/src`. App mode: `web/src/config/appMode.ts`.

## Modes

| Mode | Flag | Data source |
|------|------|-------------|
| Private | default (`VITE_APP_MODE` unset) | Live API via `/api` proxy (`privateApi`) |
| Public | `VITE_APP_MODE=public` | Static JSON under `public/data/` (`publicApi` / `staticClient`) |

Public mutating calls throw or no-op (`"Not available in public mode"`). Base path for public build: `/premier-league-simulator/`.

## Views

`AppView` in `web/src/lib/appView.ts`:

| Id | Label | Private | Public |
|----|-------|---------|--------|
| `season` | Season | yes | yes |
| `projections` | Projections | yes | yes |

Both views are visible at once in a keyboard-operable tab bar (`ViewSwitcher`, `role="tablist"`,
arrow keys, roving `tabIndex`). `season` is `DEFAULT_APP_VIEW`, the view the app opens on.

Picks and results were separate tabs until they were merged: they showed the same fixture list
and the same twenty clubs twice, split by whether a score was real or picked — a distinction the
rows already carry.

### Season

- League table + fixture list over one merged season (`SeasonView`, `SeasonLayout`, `LeagueTable`,
  `FixtureList`). The matches come from `/api/v1/season/state`, which is already the merge:
  a recorded result where one exists (`locked`), a picked scoreline everywhere else.
  Without a projection the view falls back to fixtures + `bootstrap.actualResults` and is the
  read-only record of played matches.
- **Each matchday is read through its own projection.** Pressing the `Matchday n` header opens
  `MatchdayProjectionModal`, which lists every batch — flagged where it was handed that round's
  results rather than forecasting them — plus an `Auto` row that returns the round to the default
  rule (the newest batch that forecast it). The header carries the attached batch's name, and a
  pin marker where the choice was made by hand. This is why a settled round still shows a pick
  beside its result: the newest batch has no forecast for a week it was handed, so reading the
  whole season through it lost every pick the season had already settled. The pick's distribution
  comes from the same batch, so the two can never contradict each other.
- The pick-strategy switch moves the rule on **every** batch the season is read through, not just
  the active one: the view composes several at once, and one rule per matchday is not a season
  anyone picked.
- **Matchday cutoff** (`MatchdayCutoffControl`, `lib/matchdayCutoff.ts`): the season is read as of
  a matchday. Every fixture up to it counts towards the table, everything after it is blanked in
  both panels — one rule, so the table and the fixture list cannot disagree about which matches
  count. `Now` reaches through the round being played next: the later of the highest matchday
  holding a real result and the lowest matchday still missing one (the later of the two because a
  postponement leaves an earlier round open while later rounds are played), so the cut holds every
  result plus the coming round's picks. `Full season` is the projected finish, and the cutoff lives
  in `App.tsx` so a trip to Projections and back keeps it.
- **It opens on `Now`**, so the first thing on screen is the season as it stands with the round in
  front of the reader already filled in. Pre-season nothing has been played and it opens on the
  projected finish instead. The readout tags whichever anchor it is sitting on (`now` /
  `full season`), and its title splits the round played from the round picked.
- The table is recomputed client-side from the cut via `computeLeagueStandings`, so it ignores the
  `standings` the snapshot ships. Its tone flips to `actual` and its subtitle to "recorded scores
  only" when the cut holds no picks.
- Recorded and picked scorelines are coloured apart in the fixture list (`ScoreDisplay`'s `locked`
  → green, picks cyan), matching the split in the cutoff control's counts.
- A played fixture the batch predicted shows **both**: `3 │3 - 0│ 0`, the pick either side of the
  result it was aiming at, from `ResolvedMatch.pick` (see [domain.md](domain.md)). This is what
  `ScoreDisplay`'s `actual` branch was built for; it had no caller until picks and results became
  one view. A fixture the batch was handed carries no pick and renders the result alone.
  No brackets around the pick — in football those mean a shoot-out. The result is a tinted chip
  and the picks flank it, which groups the three figures without punctuation that means
  something else.
- The distribution modal carries the same pair: `Pick: 0–2 · Recorded result: 2–0`, in the same
  two colours. It is separate from the **likeliest scoreline** line above it — under `plausible`
  and `random` the pick is not always the modal scoreline, which is the point of showing both.
- No UI path writes or clears a result: scores come from the fixturedownload sync
  (`npm run week`, `npm run fetch:results`), which is authoritative and overwrites local
  divergence. The `PUT`/`DELETE /api/v1/actual-results/:n` endpoints remain as a `curl` escape
  hatch with no client.
- Pre-season the all-zero table is suppressed in favour of the first kickoff date.
- Per-match outcome/scoreline distribution modal. Its header line is the **likeliest scoreline and
  how often it came up** (`rankScorelineCandidates`), and each outcome bar carries that outcome's
  own modal scoreline, so a near-miss draw is visible rather than implied.
- Pick strategy switch: `plausible` | `calibrated` | `random`, in that order with the default
  leading, set from the table's own title row (`LeagueTable`'s `titleActions` slot), not from a
  header menu. The per-strategy descriptions (`PICK_STRATEGY_DESCRIPTIONS`) live in the help modal
  rather than under the buttons, so switching between them is not a wall of prose.
- Public mode shows what each matchday was published through (`meta.matchdays`) but cannot move
  it: a snapshot carries one export's worth of picks and no batches to choose between.
- Prediction manager: list / switch / rename / delete, plus **Accuracy** — grades the
  selected projection against results recorded since it ran (`PredictionAccuracy.tsx`).
  Rows show `from MD<n>` when the batch carries provenance. Public mode never reaches it:
  `listPredictions` returns empty and `getPredictionAccuracy` throws.
- The accuracy panel carries three layers: headline metrics, a season-order skill trend
  (`AccuracyTrend`, from `/predictions/accuracy-history`), and the per-fixture grading list.
- Header shows `MD<n> next` from `findNextMatchday` — the same pure function the engine uses
  to name projections, so header, CLI and API cannot disagree.
- Team ratings modal adds **Change** and **Trend** from `/teams/elo-history`
  (`lib/eloSeries.ts`).

### Charts

`Sparkline.tsx` holds the two trend marks; there is no charting dependency.

- Single series, so neither carries a legend — the column header or figure caption names it.
- The Elo sparkline's *line* is de-emphasised (`--text-muted`) and only its end dot carries
  direction. Colouring the whole line by first-to-last direction contradicted the adjacent
  Change figure whenever the latest step went the other way.
- `DivergingBars` is laid out in CSS, not a stretched SVG: `preserveAspectRatio="none"`
  scales bar thickness with the container, which makes a px thickness cap meaningless.
  Bars cap at 24px, sit 2px apart, and are rounded at the data end only.

### Projections

- Position-probability table and finishing-distribution histograms (`ProjectionsView`,
  `ProjectionsTable`, `PositionDistributionBar`)
- Title / CL / European / relegation style probabilities from the active prediction
- `PositionDistributionBar` is a fixed 20-slot histogram — one slot per finishing position, so
  every row is read against the same axis and two clubs' spreads line up. Height encodes
  frequency, colour encodes zone. A shared `PositionAxis` ruler (ticks at the 1/4/5/17/20 zone
  boundaries) is rendered once per column, not per row. P10/P90 ticks mark the middle 80%, and a
  readout (`Nth: count (pct)`) appears on hover **and** touch — the `role="img"` + `aria-label`
  summary stays for screen readers. Still CSS + inline SVG, no charting dependency.
- Below 900px — where the table drops its distribution column — the view switches to
  `ProjectionCardList` (`PROJECTIONS_CARDS_QUERY`), so the distribution is never lost to the gap
  between the column-hide breakpoint and the mobile layout.

## Header controls

- View tab bar, Monte Carlo button (private), `Run Week` button (private), `More ▾` menu, view
  help. The header meta names the active batch in both views and adds the recorded-result count
  in `season`, which is the view that mixes the two.
- The Monte Carlo button is offered in both views now that picks and odds are both a batch away.
- The `More` menu holds the same two entries in every view and mode — `Team Ratings` and
  `Manage Projections` — with unavailable entries disabled and explained rather than hidden. It
  also carries the **theme** control (System / Light / Dark), which keeps the menu open while
  switching so the reader can compare.
- **Run parameters live in the Monte Carlo modal**, not the header: upset factor and season form
  are read at simulation time (`app.ts`, `runner.ts`, the CLIs) and change nothing on screen.
  Both persist on change through the settings API; `App.tsx` awaits the in-flight write before
  issuing a run. `Reset to defaults` restores `DEFAULT_UPSET_VARIANCE` /
  `DEFAULT_SEASON_ELO_DELTA_WEIGHT`. The modal also carries 1k/5k/25k run presets and a run-time
  estimate derived from the last completed batch's ms-per-run (`lib/runRate.ts`, `localStorage`).

- **`Run Week` is `npm run week` in the browser** (`WeekRunModal`, `POST /api/v1/week`). It is
  offered in every private view because the loop starts from the weekend's results, not from a
  projection, and it collapses to a `⟳` icon button on narrow screens, where a second worded
  button costs the app title. The modal takes a run count (1k/10k/25k presets and the same
  ms-per-run estimate as Monte Carlo), a projection name, and three toggles — dry run, skip the
  Club Elo refresh, skip the public snapshot. The steps, their order and their wording all
  arrive from the server as the run streams (`lib/weekRunLog.ts` folds the events into a log),
  so the browser draws the loop rather than holding a second copy of it. A `REMOTE_RESULTS_CHANGED`
  conflict is surfaced with a `Re-run and accept the changes` button, the force retry; a
  `REMOTE_UNREACHABLE` failure on the Elo step offers `Re-run without the Club Elo refresh`,
  since that is the only optional step and the weekend is already synced by then.

Public header omits the Monte Carlo button, the `Run Week` button and the pick-strategy control;
the footer can show the export timestamp from `meta.json`.

## Theme and typography

- **Two faces.** `--font-ui` (system UI stack) sets prose, labels and buttons; `--font-mono` is
  opted back in only on numeric surfaces, always paired with `font-variant-numeric: tabular-nums`
  so columns stay aligned. Base size is 14px.
- **Light and dark.** The palette lives in CSS custom properties. `:root` is the dark set (the
  default look); a `@media (prefers-color-scheme: light)` block supplies the light set, gated on
  `:not([data-theme])` so a saved choice always wins over the system, and `:root[data-theme]`
  is the explicit escape hatch in both directions. `lib/useTheme.ts` persists the choice to
  `localStorage` (works in the public build, which has no settings API) and applies it as the
  `data-theme` attribute; a small pre-paint script in `index.html` sets the attribute before
  first paint so a saved theme never flashes.
- The four zone colours are the only ones that encode data. Light values (the GitHub light
  semantics) clear 3:1 on both the page and the elevated surface, and the family stays
  distinguishable under deuteranopia/protanopia — champion/relegation is the closest pair and is
  additionally separated by position, border, tint and legend. See
  [frontend-redesign/phase-3-plan.md](frontend-redesign/phase-3-plan.md).

## Club identity

- `TeamBadge` is the single place a club's short code — and, once sourced, its crest — is
  rendered, replacing chip markup formerly duplicated across the league table, projections table,
  card list, headline strip, fixture list and ratings modal. `crest` is `null` for every club
  today, so it always falls back to the code chip; the seam exists so crests drop in without
  touching call sites. Projection rows carry only `teamId`/`teamName`, so the badge resolves the
  full `Team` (for `crest`) through the shared `lib/teamsById.ts` lookup.
- `ZoneLegend` renders the four-zone key. It sits in a table's title row (via `LeagueTable`'s
  `titleActions` slot) and once in the Projections view, never appended below a scrolling table.

## Fixture list

`FixtureList` opens anchored on the next unplayed matchday (`initialMatchday`, from
`findNextMatchday`) and carries a prev/next/jump control row above the scroller. Within a matchday
the rows run in kickoff order (date, then time, then match number), the order the round is played
in rather than the order the fixtures are numbered. The mobile layout hides the panel with CSS
rather than unmounting it, so the anchor retries on a `ResizeObserver` when a zero-height panel
gains height.

## Clients

- `web/src/api/client.ts` — private vs public API façade
- `web/src/api/staticClient.ts` — load `meta.json`, `bootstrap.json`, `league-state.json`, `projections.json`, `distributions.json` (cached, and fetched lazily on the first distribution opened — it carries all 380 fixtures)

## Simulation UI note

Server-side simulation CRUD and simulate endpoints exist and are covered by `engine/tests/api.test.ts`; they are driven by the `simulate:season` CLI and Monte Carlo, not by the browser. The web shell has **no simulation UI** — the shipped UI is prediction-centric (Monte Carlo + picks + actuals), and `client.ts` exposes no wrappers for the simulation endpoints.
