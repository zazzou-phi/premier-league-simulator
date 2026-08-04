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
| `consensus` | Consensus | yes | yes |
| `projections` | Projections | yes | yes |
| `results` | Results | yes | yes |

All three views are visible at once in a keyboard-operable tab bar (`ViewSwitcher`, `role="tablist"`,
arrow keys, roving `tabIndex`).

### Consensus

- League table + fixture list for the active prediction (`ConsensusView`, `SeasonLayout`, `LeagueTable`, `FixtureList`)
- Per-match outcome/scoreline distribution modal
- Consensus mode switch: `scoreline` | `outcome` | `sample`, set from the table's own title row
  (`LeagueTable`'s `titleActions` slot), not from a header menu
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

- Position-probability table and distribution bars (`ProjectionsView`, `ProjectionsTable`, `PositionDistributionBar`)
- Title / CL / European / relegation style probabilities from the active prediction

### Results

- **Read-only** record of played matches (`ActualResultsView`), derived client-side from
  `bootstrap.actualResults` via `computeLeagueStandings`. No UI path writes or clears a result:
  scores come from the fixturedownload sync (`npm run week`, `npm run fetch:results`), which is
  authoritative and overwrites local divergence. The `PUT`/`DELETE /api/v1/actual-results/:n`
  endpoints remain as a `curl` escape hatch with no client.
- Pre-season the all-zero table is suppressed in favour of the first kickoff date.

## Header controls

- View tab bar, Monte Carlo button (private, projection views), `More ▾` menu, view help.
- The `More` menu holds the same two entries in every view and mode — `Team Ratings` and
  `Manage Projections` — with unavailable entries disabled and explained rather than hidden.
- **Run parameters live in the Monte Carlo modal**, not the header: upset factor and season form
  are read at simulation time (`app.ts`, `runner.ts`, the CLIs) and change nothing on screen.
  Both persist on change through the settings API; `App.tsx` awaits the in-flight write before
  issuing a run. `Reset to defaults` restores `DEFAULT_UPSET_VARIANCE` /
  `DEFAULT_SEASON_ELO_DELTA_WEIGHT`.

Public header omits the Monte Carlo button and the consensus-mode control; the footer can show the
export timestamp from `meta.json`.

## Fixture list

`FixtureList` opens anchored on the next unplayed matchday (`initialMatchday`, from
`findNextMatchday`) and carries a prev/next/jump control row above the scroller. The mobile layout
hides the panel with CSS rather than unmounting it, so the anchor retries on a `ResizeObserver`
when a zero-height panel gains height.

## Clients

- `web/src/api/client.ts` — private vs public API façade
- `web/src/api/staticClient.ts` — load `meta.json`, `bootstrap.json`, `league-state.json`, `projections.json`

## Simulation UI note

Server-side simulation CRUD and simulate endpoints exist and are covered by `engine/tests/api.test.ts`; they are driven by the `simulate:season` CLI and Monte Carlo, not by the browser. The web shell has **no simulation UI** — the shipped UI is prediction-centric (Monte Carlo + consensus + actuals), and `client.ts` exposes no wrappers for the simulation endpoints.
