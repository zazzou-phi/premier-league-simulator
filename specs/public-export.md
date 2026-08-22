# Public export

CLI: `cd engine && npm run export:public` → `engine/src/export-public-cli.ts` → `writePublicSnapshot`.

Default output directory: `web/public/data/` (override with `--out`). DB via `--db`.

## Reveal policy

`REVEAL_POLICY = 'next-round'` (`engine/src/export/publicSnapshot.ts`).

A forecast is worth more before kickoff than after it, so the upcoming round is published in
advance. `isRevealed(match, at, round)` is true when the match is **locked** (actual result),
`hasKickedOff(fixture, now)` is true, or its matchday is **no later than the next round** —
the lowest matchday with an unrecorded fixture, via `findNextMatchday`. The first two clauses
keep the set monotone: nothing that has been shown becomes secret again.

`hasKickedOff` compares fixture `date`+`time` to the current instant formatted in
`Europe/London`.

`redactUnrevealed(state, at)`:

1. Keep matches that are revealed by the rule above
2. Blank every other predicted score (`scheduled`, null goals)
3. **Recompute standings from locked or kicked-off matches only** — deliberately a narrower
   set than the revealed one

Step 3 is what keeps invariant 12 true now that reveal runs ahead of kickoff: the next round is
shown as a forecast, but points from a match nobody has played would imply a result. So a
snapshot can show `MD8` picks while its table still reads `MD7`.

Later rounds stay blank, so the snapshot cannot be read as a season-long script.

Projections (season-long position probabilities) are exported as-is; they are not per-fixture futures.

`eloHistory` is exported unredacted: dated snapshots are a record of past ratings, not a
future prediction.

## Per-fixture distributions

`distributions.json` carries the outcome and scoreline spread behind each **revealed** match and
no others — the spread behind a published pick tells a reader nothing the pick did not already,
while an unrevealed match's distribution *is* the forecast the redaction removes. The public
client loads the file once and serves `getMatchDistribution` from it, so the distribution modal
works on the static site; blanked fixtures render an inert score rather than a failing click
(`FixtureList`'s `canOpen`).

Size scales with what has been revealed: ~54 scorelines per match, so a matchday costs ~25 KB
and a full season reaches ~960 KB only once every match has been played.

Grading stays private-mode: a revealed-only subset cannot grade a whole batch, so
`getAccuracyHistory` still returns an empty series there.

## Snapshot files

| File | Content |
|------|---------|
| `meta.json` | `exportedAt`, `revealPolicy: "next-round"`, active `predictionId` / `predictionName`, `asOfMatchday`, `runs` |
| `bootstrap.json` | `teams`, `fixtures`, `actualResults`, `eloHistory` |
| `league-state.json` | Redacted picked `SeasonState`, or `null` if no prediction |
| `projections.json` | `{ runs, teams }` or `null` |
| `distributions.json` | `MatchDistribution[]` for revealed matches only (`[]` with no prediction) |

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
