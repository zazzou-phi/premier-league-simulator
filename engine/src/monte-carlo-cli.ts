import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { runMonteCarlo } from './simulation/monteCarlo.js';

function parseArgs(argv: string[]): {
  runs: number;
  name?: string;
  dbPath?: string;
  save: boolean;
} {
  let runs = 1000;
  let name: string | undefined;
  let dbPath: string | undefined;
  let save = true;

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--runs' || argv[i] === '-n') && argv[i + 1]) runs = Number(argv[++i]);
    else if (argv[i] === '--name' && argv[i + 1]) name = argv[++i];
    else if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
    else if (argv[i] === '--no-save') save = false;
  }

  return { runs, name, dbPath, save };
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

const teams = repo.getTeams();
if (teams.length === 0) {
  console.error('No teams found. Run `npm run seed` first.');
  process.exit(1);
}

const settings = repo.getSettings();
let lastReported = -1;

const result = await runMonteCarlo(teams, repo.getFixtures(), {
  runs: args.runs,
  upsetVariance: settings.upsetVariance,
  eloDeltaWeight: settings.seasonEloDeltaWeight,
  lockedResults: repo.getActualResultsByMatch(),
  onProgress: (completed, total) => {
    const percent = Math.floor((completed / total) * 100);
    if (percent !== lastReported && percent % 10 === 0) {
      lastReported = percent;
      process.stderr.write(`\r  simulating... ${percent}%`);
    }
  },
});
process.stderr.write('\r\x1b[K');

const prediction = args.save
  ? repo.savePredictionFromMonteCarlo(args.name ?? `Monte Carlo ${args.runs} runs`, result)
  : null;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`.padStart(7);

console.log(`\n${result.runs} seasons simulated in ${result.elapsedMs}ms`);
if (prediction) console.log(`Saved as prediction #${prediction.id} "${prediction.name}"`);

console.log('\nPos  Team                       Pts    Title     Top4    Europe    Releg');
console.log('-'.repeat(76));
result.teams.forEach((team, index) => {
  console.log(
    `${String(index + 1).padStart(3)}  ${team.teamName.padEnd(24)}` +
      `${team.averagePoints.toFixed(1).padStart(5)}  ` +
      `${pct(team.titleProbability)}  ` +
      `${pct(team.championsLeagueProbability)}  ` +
      `${pct(team.europeanProbability)}  ` +
      `${pct(team.relegationProbability)}`,
  );
});

const goalsPerMatch =
  result.teams.reduce((sum, team) => sum + team.averageGoalsFor, 0) / repo.getFixtures().length;
console.log('-'.repeat(76));
console.log(`Average goals per match: ${goalsPerMatch.toFixed(2)}`);
