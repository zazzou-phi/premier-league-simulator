/**
 * Reconcile the stored fixture calendar with the remote one.
 *
 * Only the schedule moves — never who is playing, and never a recorded result. When a fixture
 * does move, the Elo history is rebuilt so each round's snapshot is dated to when that round
 * actually finished, and the point left under the old date is pruned.
 */
import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { backfillEloHistory } from './data/backfillEloHistory.js';
import { syncFixturesFromRemote } from './data/syncFixtures.js';

function parseArgs(argv: string[]): { dbPath?: string; dryRun: boolean } {
  let dbPath: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
  }
  return { dbPath, dryRun };
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

const summary = await syncFixturesFromRemote({ repo, dryRun: args.dryRun });

if (summary.mismatched.length > 0) {
  console.error(
    `\n${summary.mismatched.length} fixture(s) have different teams remotely than stored.\n` +
      'The match number is what results, predictions and Elo history key off, so these are\n' +
      'reported rather than applied:\n',
  );
  for (const mismatch of summary.mismatched) {
    console.error(`  #${mismatch.matchNumber}  stored ${mismatch.stored}  remote ${mismatch.remote}`);
  }
  console.error('\nIf the remote is right, the fixture list has been renumbered and needs a reseed.');
}

if (summary.moved.length === 0) {
  console.log(`No fixtures have moved. ${summary.unchanged} already match the remote calendar.`);
  process.exit(summary.mismatched.length > 0 ? 1 : 0);
}

console.log(
  args.dryRun
    ? `\n${summary.moved.length} fixture(s) would move:\n`
    : `\n${summary.moved.length} fixture(s) moved:\n`,
);

for (const move of summary.moved) {
  const round = move.roundChanged ? ` [round ${move.from.matchday} → ${move.to.matchday}]` : '';
  const played = move.played ? '  (already played)' : '';
  console.log(
    `  #${move.matchNumber}  ${move.homeName} v ${move.awayName}\n` +
      `      ${move.from.date} ${move.from.time} → ${move.to.date} ${move.to.time}${round}${played}`,
  );
}

if (!args.dryRun) {
  const history = backfillEloHistory({ repo, prune: true });
  console.log(
    `\nRebuilt Elo history: ${history.snapshots} rows across ${history.rounds.length} round(s)` +
      (history.pruned > 0 ? `, pruned ${history.pruned} stale date(s).` : '.'),
  );
}
