# Public export

CLI: `cd engine && npm run export:public` → `engine/src/export-public-cli.ts` → `writePublicSnapshot`.

Default output directory: `web/public/data/` (override with `--out`). DB via `--db`.

## Reveal policy

`REVEAL_POLICY = 'full'` (`engine/src/export/publicSnapshot.ts`). The snapshot is the private
app's state verbatim: `buildAssignedSeasonState`, unmodified — every matchday through the
projection attached to it, which is what the private app reads too.

The export used to blank every round past the next one to be played, and to recompute the
published table from locked or kicked-off matches only. That was protection against giving a
future away to someone reading along; the site is general interest and there is no such
someone, so it was dropped along with `redactUnrevealed`, `isRevealed`, `hasKickedOff` and
`nextRound`. `revealPolicy` survives in `meta.json` so a snapshot still says which policy
produced it, and so an older `"next-round"` snapshot stays readable.

The published table is no longer a field at all in practice: the web client recomputes it from
whichever matchday the reader has the Season view's cutoff set to (see [web.md](web.md)), so the
`standings` the snapshot carries go unread.

`eloHistory` is exported unredacted: dated snapshots are a record of past ratings, not a
future prediction.

## Matchday projections

`meta.matchdays` publishes what each round was exported through: the batch that supplied its
picks and the spread behind them, flagged `pinned` and `forecast`. Composing rather than
flattening is what puts a settled round's picks in the snapshot at all — the newest batch was
handed those results and kept no forecast of its own, so exporting the whole season through it
published a run of results with nothing to compare them to.

The public site reads the attachments but cannot move one: a static snapshot carries one
export's worth of picks and no batches to choose between. A snapshot exported before this field
existed has no `matchdays`, and the client reads that as "one batch for the whole season" and
falls back to `meta.predictionId`.

## Per-fixture distributions

`distributions.json` carries the outcome and scoreline spread behind **every** fixture, ordered
by match number, each taken from the batch its matchday is attached to — so a published spread
can never contradict the pick above it. The spread behind a published pick tells a reader
nothing the pick did not already. The public client loads the file once and serves `getMatchDistribution` from it, so the
distribution modal works on the static site.

Size: ~54 scorelines per match, so a full season is ~1.7 MB on disk and ~90 KB gzipped over the
wire. `staticClient` fetches it lazily — on the first distribution a reader opens — so a visit
that never opens one never pays for it. It is committed with the rest of the snapshot, so each
weekly export writes a fresh ~1.7 MB blob into git history.

Grading stays private-mode: it needs the provenance of what was locked when each batch ran
(`prediction_locked_matches`) and a trend needs every batch, neither of which the snapshot
carries, so `getAccuracyHistory` still returns an empty series there.

## Snapshot files

| File | Content |
|------|---------|
| `meta.json` | `exportedAt`, `revealPolicy: "full"`, active `predictionId` / `predictionName`, `asOfMatchday`, `runs`, `matchdays` |
| `bootstrap.json` | `teams`, `fixtures`, `actualResults`, `eloHistory` |
| `league-state.json` | The composed `SeasonState` as the private app builds it, or `null` if no prediction |
| `projections.json` | `{ runs, teams }` or `null` |
| `distributions.json` | `MatchDistribution[]`, one per fixture in match order, from that fixture's matchday's batch (`[]` with no prediction) |

The actuals-only table is deliberately not exported: the web client derives it from
`bootstrap.actualResults` with the same engine code, and no client ever fetched the file.

Active prediction = most recently created prediction. It still names the snapshot and supplies
`projections.json`, the season-wide finishing odds, which only one batch can project.

## Public build pipeline

```
cd engine && npm run export:public
cd web && npm run build:public
```

`npm run week` runs the export as its last step, so a weekly loop only needs the `build:public`
half here.

The public site must not assume a live API or SQLite.
