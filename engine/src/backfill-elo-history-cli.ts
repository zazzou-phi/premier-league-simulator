/**
 * Rebuild `team_elo_history` from the results already recorded, one point per round.
 *
 * Safe to run at any time: every point is recomputed from `teams.anchor_elo`, and re-recording
 * a round overwrites the row it wrote before rather than adding a second one. Run it to fill in
 * rounds that happened while nobody ran the week loop, or to rebuild the series from scratch
 * after restoring a database.
 */
import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { backfillEloHistory } from './data/backfillEloHistory.js';

function parseArgs(argv: string[]): { dbPath?: string; dryRun: boolean; prune: boolean } {
  let dbPath: string | undefined;
  let dryRun = false;
  let prune = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--prune') prune = true;
  }
  return { dbPath, dryRun, prune };
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

const before = repo.getEloHistoryDates().length;
const summary = backfillEloHistory({ repo, dryRun: args.dryRun, prune: args.prune });

if (summary.points.length === 0) {
  console.log('No results recorded yet, so there is no history to rebuild.');
  process.exit(0);
}

console.log(
  args.dryRun
    ? `Would write ${summary.snapshots} rows across ${summary.points.length} day(s) of football:\n`
    : `Wrote ${summary.snapshots} rows across ${summary.points.length} day(s) of football:\n`,
);

console.log('  date         matches   round(s)');
console.log('  ----------   -------   --------');
for (const point of summary.points) {
  console.log(
    `  ${point.asOf}   ${String(point.matches).padStart(7)}   ${point.matchdays.join(', ')}`,
  );
}

if (!args.dryRun) {
  const after = repo.getEloHistoryDates().length;
  console.log(
    `\nSnapshot dates: ${before} → ${after}` +
      (summary.pruned > 0 ? `, pruned ${summary.pruned} that no round ends on.` : '.'),
  );
}
