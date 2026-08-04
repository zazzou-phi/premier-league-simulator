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
| `results` | Results | yes | **hidden** |

### Consensus

- League table + fixture list for the active prediction (`ConsensusView`, `SeasonLayout`, `LeagueTable`, `FixtureList`)
- Per-match outcome/scoreline distribution modal
- Consensus mode switch: `scoreline` | `outcome` | `sample`
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

### Results (private only)

- Record and clear actual scores (`ActualResultsView`, `ScoreEditor`)
- Table reflects only locked actuals

## Header controls (private)

- Upset variance slider (persisted via settings API)
- Season Elo delta weight control
- Team ratings modal (view / edit Elo)
- Monte Carlo modal (NDJSON progress stream)
- View help

Public header is read-only; footer can show export timestamp from `meta.json`.

## Clients

- `web/src/api/client.ts` — private vs public API façade
- `web/src/api/staticClient.ts` — load `meta.json`, `bootstrap.json`, `league-state.json`, `projections.json`

`actual-results-state.json` is written by the export but **never fetched** — `staticClient` has no
loader for it, and `ActualResultsView` derives the actual table client-side from
`bootstrap.actualResults`. Slated for removal in
[frontend-redesign/phase-2.md](frontend-redesign/phase-2.md) §2.6.

## Simulation UI note

Server-side simulation CRUD and simulate endpoints exist and are covered by `engine/tests/api.test.ts`; they are driven by the `simulate:season` CLI and Monte Carlo, not by the browser. The web shell has **no simulation UI** — the shipped UI is prediction-centric (Monte Carlo + consensus + actuals), and `client.ts` exposes no wrappers for the simulation endpoints.
