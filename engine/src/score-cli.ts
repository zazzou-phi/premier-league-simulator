import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { formatAccuracyReport, pickGradeablePrediction } from './scoring/report.js';

function parseArgs(argv: string[]): {
  predictionId?: number;
  dbPath?: string;
  all: boolean;
  json: boolean;
  showMatches: boolean;
} {
  let predictionId: number | undefined;
  let dbPath: string | undefined;
  let all = false;
  let json = false;
  let showMatches = false;

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--prediction' || argv[i] === '-p') && argv[i + 1]) {
      predictionId = Number(argv[++i]);
    } else if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
    else if (argv[i] === '--all') all = true;
    else if (argv[i] === '--json') json = true;
    else if (argv[i] === '--matches') showMatches = true;
  }

  if (predictionId != null && !Number.isInteger(predictionId)) {
    throw new Error('--prediction must be an integer prediction id');
  }
  return { predictionId, dbPath, all, json, showMatches };
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

const ids = args.all
  ? repo
      .listPredictions(1, 1000)
      .items.sort((a, b) => a.id - b.id)
      .map((prediction) => prediction.id)
  : [args.predictionId ?? pickGradeablePrediction(repo)?.id].filter(
      (id): id is number => id != null,
    );

if (ids.length === 0) {
  console.error(
    'No prediction has results to grade yet. Run `npm run monte-carlo`, wait for the ' +
      'matches to be played, then `npm run fetch:results`.',
  );
  process.exit(1);
}

let reports;
try {
  reports = ids.map((id) => repo.getPredictionAccuracy(id));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(args.all ? reports : reports[0], null, 2));
} else {
  console.log(reports.map((report) => formatAccuracyReport(report, args.showMatches)).join('\n\n'));
}
