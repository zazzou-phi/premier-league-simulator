import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { SeasonRunner } from './simulation/runner.js';

function parseArgs(argv: string[]): {
  mode: 'season' | 'matchday';
  simulationId?: number;
  matchday?: number;
  dbPath?: string;
} {
  const mode = argv[0] === 'matchday' ? 'matchday' : 'season';
  let simulationId: number | undefined;
  let matchday: number | undefined;
  let dbPath: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--simulation-id' && argv[i + 1]) simulationId = Number(argv[++i]);
    else if (argv[i] === '--matchday' && argv[i + 1]) matchday = Number(argv[++i]);
    else if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
  }

  return { mode, simulationId, matchday, dbPath };
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

const simulationId = args.simulationId ?? repo.ensureDefaultSimulation().id;
const runner = new SeasonRunner(repo);

const result =
  args.mode === 'matchday'
    ? args.matchday != null
      ? runner.simulateUpToMatchday(simulationId, args.matchday)
      : runner.simulateNextMatchday(simulationId)
    : runner.simulateRestOfSeason(simulationId);

const state = repo.buildSeasonState(simulationId);

console.log(JSON.stringify(result, null, 2));
console.log(`\nPos  Team  Pl   W   D   L    GF   GA    GD  Pts`);
console.log('-'.repeat(50));
for (const row of state.standings) {
  console.log(
    `${String(row.position).padStart(3)}  ${row.team.shortName.padEnd(5)}` +
      `${String(row.played).padStart(2)}  ${String(row.won).padStart(2)}  ` +
      `${String(row.drawn).padStart(2)}  ${String(row.lost).padStart(2)}  ` +
      `${String(row.goalsFor).padStart(4)} ${String(row.goalsAgainst).padStart(4)}  ` +
      `${String(row.goalDifference).padStart(4)}  ${String(row.points).padStart(3)}`,
  );
}
