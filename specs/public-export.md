# Public export

CLI: `cd engine && npm run export:public` → `engine/src/export-public-cli.ts` → `writePublicSnapshot`.

Default output directory: `web/public/data/` (override with `--out`). DB via `--db`.

## Reveal policy

`REVEAL_POLICY = 'kickoff'` (`engine/src/export/publicSnapshot.ts`).

A fixture is revealed when `hasKickedOff(fixture, now)` is true: compare fixture `date`+`time` to the current instant formatted in `Europe/London`.

`redactUnrevealed(state, at)`:

1. Keep matches that are **locked** (actual result) or have kicked off
2. Blank all other predicted scores (`scheduled`, null goals)
3. **Recompute standings** from remaining played matches only

This prevents the published table from leaking future picked scorelines. Recorded actuals are always included.

Projections (season-long position probabilities) are exported as-is; they are not per-fixture futures.

`eloHistory` is exported unredacted: dated snapshots are a record of past ratings, not a
future prediction. Per-fixture distributions are still withheld, so the public build cannot
grade a projection — `getAccuracyHistory` returns an empty series there.

## Snapshot files

| File | Content |
|------|---------|
| `meta.json` | `exportedAt`, `revealPolicy: "kickoff"`, active `predictionId` / `predictionName`, `asOfMatchday`, `runs` |
| `bootstrap.json` | `teams`, `fixtures`, `actualResults`, `eloHistory` |
| `league-state.json` | Redacted picked `SeasonState`, or `null` if no prediction |
| `projections.json` | `{ runs, teams }` or `null` |

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
