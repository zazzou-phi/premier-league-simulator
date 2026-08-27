# Public export

CLI: `cd engine && npm run export:public` → `engine/src/export-public-cli.ts` → `writePublicSnapshot`.

Default output directory: `web/public/data/` (override with `--out`). DB via `--db`.

## Reveal policy

`REVEAL_POLICY = 'full'` (`engine/src/export/publicSnapshot.ts`). The snapshot is the private
app's state verbatim: `buildPredictionState` for the active prediction, unmodified.

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

## Per-fixture distributions

`distributions.json` carries the outcome and scoreline spread behind **every** fixture, ordered
by match number — the spread behind a published pick tells a reader nothing the pick did not
already. The public client loads the file once and serves `getMatchDistribution` from it, so the
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
| `meta.json` | `exportedAt`, `revealPolicy: "full"`, active `predictionId` / `predictionName`, `asOfMatchday`, `runs` |
| `bootstrap.json` | `teams`, `fixtures`, `actualResults`, `eloHistory` |
| `league-state.json` | The picked `SeasonState` as the private app builds it, or `null` if no prediction |
| `projections.json` | `{ runs, teams }` or `null` |
| `distributions.json` | `MatchDistribution[]`, one per fixture in match order (`[]` with no prediction) |

The actuals-only table is deliberately not exported: the web client derives it from
`bootstrap.actualResults` with the same engine code, and no client ever fetched the file.

Active prediction = most recently updated prediction.

## Public build pipeline

```
cd engine && npm run export:public
cd web && npm run build:public
```

`npm run week` runs the export as its last step, so a weekly loop only needs the `build:public`
half here.

The public site must not assume a live API or SQLite.
