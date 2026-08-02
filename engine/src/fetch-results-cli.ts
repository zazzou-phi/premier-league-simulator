import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { syncTeamRatingsFromClubElo } from './data/fetchRatings.js';
import { syncActualResultsFromRemote } from './data/syncResults.js';

function parseArgs(argv: string[]): {
  dbPath?: string;
  dryRun: boolean;
  skipRatings: boolean;
} {
  let dbPath: string | undefined;
  let dryRun = false;
  let skipRatings = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--no-ratings') skipRatings = true;
  }

  return { dbPath, dryRun, skipRatings };
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

if (repo.getFixtures().length === 0) {
  console.error('No fixtures found. Run `npm run seed` first.');
  process.exit(1);
}

const results = await syncActualResultsFromRemote({ repo, dryRun: args.dryRun });
const ratings = args.skipRatings
  ? null
  : await syncTeamRatingsFromClubElo({ repo, dryRun: args.dryRun });

console.log(JSON.stringify({ ok: true, results, ratings }, null, 2));
