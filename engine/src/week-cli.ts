import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPremierLeagueFixturesCsv } from './data/fetchFixtures.js';
import { syncTeamRatingsFromClubElo } from './data/fetchRatings.js';
import { syncActualResultsFromRemote } from './data/syncResults.js';
import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { writePublicSnapshot } from './export/writePublicSnapshot.js';
import { formatAccuracyReport, pickGradeablePrediction } from './scoring/report.js';
import { runMonteCarlo } from './simulation/monteCarlo.js';

/**
 * One command for the in-season loop: pull the weekend's results, refresh Elo, grade the
 * projection those results just settled, then re-project the rest of the season and
 * re-export the public snapshot.
 *
 * The step order matters — projecting before syncing results would ignore the weekend —
 * so it is fixed here rather than left to whoever is typing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const defaultExportDir = resolve(join(here, '../../web/public/data'));

interface Args {
  runs: number;
  dbPath?: string;
  name?: string;
  dryRun: boolean;
  skipRatings: boolean;
  skipExport: boolean;
  force: boolean;
  exportDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    runs: 10_000,
    dryRun: false,
    skipRatings: false,
    skipExport: false,
    force: false,
    exportDir: defaultExportDir,
  };

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--runs' || argv[i] === '-n') && argv[i + 1]) args.runs = Number(argv[++i]);
    else if (argv[i] === '--db' && argv[i + 1]) args.dbPath = argv[++i];
    else if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) args.exportDir = resolve(argv[++i]!);
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--no-ratings') args.skipRatings = true;
    else if (argv[i] === '--no-export') args.skipExport = true;
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${argv[i]}\n\n${USAGE}`);
      process.exit(1);
    }
  }

  if (!Number.isFinite(args.runs) || args.runs < 1) {
    console.error('--runs must be a positive integer');
    process.exit(1);
  }
  return args;
}

const USAGE = `Advance the season by one week.

  npm run week -- [options]

  --runs, -n <N>   Monte Carlo runs for the new projection (default 10000)
  --name <text>    Name for the new projection (default "MD<n> · <date>")
  --dry-run        Report what would change; write nothing
  --no-ratings     Skip the Club Elo refresh
  --no-export      Skip the public JSON snapshot
  --out <dir>      Snapshot output directory
  --force          Proceed even when the remote changed a result already recorded
  --db <path>      Database path`;

function step(index: number, total: number, label: string): void {
  console.log(`\n[${index}/${total}] ${label}`);
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

if (repo.getFixtures().length === 0) {
  console.error('No fixtures found. Run `npm run seed` first.');
  process.exit(1);
}

const totalSteps = 5 + (args.skipExport ? 0 : 1);

// The batch being graded has to be chosen before the new one is saved.
const previous = pickGradeablePrediction(repo);

// -------------------------------------------------------------- 1. results

step(1, totalSteps, 'Syncing results from fixturedownload');

const csv = await fetchPremierLeagueFixturesCsv();
const preview = await syncActualResultsFromRemote({ repo, csv, dryRun: true });

if (preview.overwritten > 0 && !args.force && !args.dryRun) {
  console.error(
    `\nThe remote has changed ${preview.overwritten} result(s) that were already recorded.\n` +
      'That is usually a corrected scoreline, but it silently rewrites recorded history and\n' +
      'the grades of every past projection. Review with:\n\n' +
      '  npm run fetch:results -- --dry-run\n\n' +
      'then re-run with --force to accept the changes.',
  );
  process.exit(1);
}

const results = args.dryRun
  ? preview
  : await syncActualResultsFromRemote({ repo, csv, dryRun: false });

console.log(
  `  ${results.applied} newly locked, ${results.overwritten} changed, ` +
    `${results.unchanged} unchanged (${results.localActuals} locked in total)`,
);

// ---------------------------------------------------------------- 2. ratings

step(2, totalSteps, args.skipRatings ? 'Skipping Club Elo refresh' : 'Refreshing Club Elo');

if (!args.skipRatings) {
  const ratings = await syncTeamRatingsFromClubElo({ repo, dryRun: args.dryRun });
  console.log(`  ${ratings.updated} ratings changed, ${ratings.unchanged} unchanged (as of ${ratings.asOf})`);
  for (const mover of ratings.movers ?? []) {
    const sign = mover.delta >= 0 ? '+' : '';
    console.log(`    ${mover.name.padEnd(24)} ${mover.from.toFixed(0)} → ${mover.to.toFixed(0)}  ${sign}${mover.delta.toFixed(0)}`);
  }
}

// --------------------------------------------------------------- 3. scoring

step(3, totalSteps, 'Grading the previous projection');

if (!previous) {
  console.log('  No earlier projection has gradeable results yet.');
} else {
  console.log();
  console.log(
    formatAccuracyReport(repo.getPredictionAccuracy(previous.id))
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  );
}

// ----------------------------------------------------------- 4. monte carlo

const matchday = repo.getNextMatchday();
const name =
  args.name ??
  (matchday == null
    ? `Final · ${new Date().toISOString().slice(0, 10)}`
    : `MD${matchday} · ${new Date().toISOString().slice(0, 10)}`);

step(4, totalSteps, `Projecting the rest of the season as "${name}"`);

if (matchday == null) {
  console.log('  Every fixture is locked — the season is complete, nothing left to project.');
} else if (args.dryRun) {
  console.log(`  Would run ${args.runs.toLocaleString()} seasons and save as "${name}".`);
} else {
  const settings = repo.getSettings();
  let lastReported = -1;

  const result = await runMonteCarlo(repo.getTeams(), repo.getFixtures(), {
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

  const prediction = repo.savePredictionFromMonteCarlo(name, result);
  console.log(
    `  ${result.runs.toLocaleString()} seasons in ${result.elapsedMs}ms → prediction #${prediction.id}`,
  );

  const top = result.teams.slice(0, 5);
  console.log('\n  Title race');
  for (const team of top) {
    console.log(
      `    ${team.teamName.padEnd(24)} ${team.averagePoints.toFixed(1).padStart(5)} pts   ` +
        `title ${(team.titleProbability * 100).toFixed(1).padStart(5)}%   ` +
        `top4 ${(team.championsLeagueProbability * 100).toFixed(1).padStart(5)}%`,
    );
  }
  const relegation = [...result.teams]
    .sort((a, b) => b.relegationProbability - a.relegationProbability)
    .slice(0, 3);
  console.log('\n  Relegation risk');
  for (const team of relegation) {
    console.log(
      `    ${team.teamName.padEnd(24)} ${(team.relegationProbability * 100).toFixed(1).padStart(5)}%`,
    );
  }
}

// ---------------------------------------------------------------- 5. export

if (!args.skipExport) {
  step(5, totalSteps, 'Writing the public snapshot');
  if (args.dryRun) {
    console.log(`  Would write JSON snapshots to ${args.exportDir}`);
  } else {
    const meta = await writePublicSnapshot(repo, args.exportDir);
    console.log(`  ${args.exportDir} (reveal policy: ${meta.revealPolicy})`);
  }
}

// ------------------------------------------------------------------ 6. wrap

step(totalSteps, totalSteps, 'Next');

if (args.dryRun) {
  console.log('  Dry run — nothing was written. Re-run without --dry-run to apply.');
} else {
  const today = new Date().toISOString().slice(0, 10);
  console.log(
    '  The database is gitignored, so commit the CSVs — they are the recoverable record\n' +
      '  of what was known this week:\n\n' +
      '    git add data/teams.csv data/fixtures.csv\n' +
      `    git commit -m "Results and ratings as of ${today}"\n`,
  );
}
