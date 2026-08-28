import { resolve } from 'node:path';
import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { formatAccuracyReport } from './scoring/report.js';
import {
  countWeekSteps,
  getDefaultSnapshotDir,
  RemoteResultsChangedError,
  runWeek,
  WEEK_RUN_DEFAULT_RUNS,
  type WeekRunEvent,
  type WeekStepResultEvent,
} from './season/weekRun.js';

/**
 * One command for the in-season loop. The order of the steps and everything they do lives in
 * `season/weekRun.ts`, shared with the API; this file is the terminal rendering of it.
 */

interface Args {
  runs: number;
  dbPath?: string;
  name?: string;
  dryRun: boolean;
  skipRatings: boolean;
  useClubElo: boolean;
  skipExport: boolean;
  force: boolean;
  exportDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    runs: WEEK_RUN_DEFAULT_RUNS,
    dryRun: false,
    skipRatings: false,
    useClubElo: false,
    skipExport: false,
    force: false,
    exportDir: getDefaultSnapshotDir(),
  };

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--runs' || argv[i] === '-n') && argv[i + 1]) args.runs = Number(argv[++i]);
    else if (argv[i] === '--db' && argv[i + 1]) args.dbPath = argv[++i];
    else if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) args.exportDir = resolve(argv[++i]!);
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--no-ratings') args.skipRatings = true;
    else if (argv[i] === '--clubelo') args.useClubElo = true;
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

  --runs, -n <N>   Monte Carlo runs for the new projection (default ${WEEK_RUN_DEFAULT_RUNS})
  --name <text>    Name for the new projection (default "MD<n> · <date>")
  --dry-run        Report what would change; write nothing
  --no-ratings     Skip the ratings update entirely
  --clubelo        Refresh from clubelo instead of recomputing from results
  --no-export      Skip the public JSON snapshot
  --out <dir>      Snapshot output directory
  --force          Proceed even when the remote changed a result already recorded
  --db <path>      Database path`;

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

if (repo.getFixtures().length === 0) {
  console.error('No fixtures found. Run `npm run seed` first.');
  process.exit(1);
}

// The loop's own steps, plus the "Next" wrap-up this command prints once they are done.
const totalSteps = countWeekSteps(args) + 1;

let lastReportedPercent = -1;

/** Clear the in-place progress line before printing anything else over it. */
function clearProgressLine(): void {
  if (lastReportedPercent >= 0) process.stderr.write('\r\x1b[K');
  lastReportedPercent = -1;
}

function renderStepResult(event: WeekStepResultEvent): void {
  switch (event.step) {
    case 'results': {
      const { applied, overwritten, unchanged, localActuals } = event.results;
      console.log(
        `  ${applied} newly locked, ${overwritten} changed, ` +
          `${unchanged} unchanged (${localActuals} locked in total)`,
      );
      return;
    }
    case 'ratings': {
      const ratings = event.ratings;
      if (!ratings) return;
      console.log(
        `  ${ratings.updated} ratings changed, ${ratings.unchanged} unchanged (as of ${ratings.asOf})`,
      );
      for (const mover of ratings.movers ?? []) {
        const sign = mover.delta >= 0 ? '+' : '';
        console.log(
          `    ${mover.name.padEnd(24)} ${mover.from.toFixed(0)} → ${mover.to.toFixed(0)}  ${sign}${mover.delta.toFixed(0)}`,
        );
      }
      return;
    }
    case 'grading': {
      if (!event.graded) {
        console.log('  No earlier projection has gradeable results yet.');
        return;
      }
      console.log();
      console.log(
        formatAccuracyReport(event.graded.accuracy)
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      );
      return;
    }
    case 'projection': {
      clearProgressLine();
      const projection = event.projection;
      if (projection.skipped === 'season-complete') {
        console.log('  Every fixture is locked — the season is complete, nothing left to project.');
        return;
      }
      if (projection.skipped === 'dry-run') {
        console.log(
          `  Would run ${(projection.runs ?? 0).toLocaleString()} seasons and save as "${projection.name}".`,
        );
        return;
      }
      console.log(
        `  ${(projection.runs ?? 0).toLocaleString()} seasons in ${projection.elapsedMs}ms → ` +
          `prediction #${projection.predictionId}`,
      );

      const teams = projection.teams ?? [];
      console.log('\n  Title race');
      for (const team of teams.slice(0, 5)) {
        console.log(
          `    ${team.teamName.padEnd(24)} ${team.averagePoints.toFixed(1).padStart(5)} pts   ` +
            `title ${(team.titleProbability * 100).toFixed(1).padStart(5)}%   ` +
            `top4 ${(team.championsLeagueProbability * 100).toFixed(1).padStart(5)}%`,
        );
      }
      const relegation = [...teams]
        .sort((a, b) => b.relegationProbability - a.relegationProbability)
        .slice(0, 3);
      console.log('\n  Relegation risk');
      for (const team of relegation) {
        console.log(
          `    ${team.teamName.padEnd(24)} ${(team.relegationProbability * 100).toFixed(1).padStart(5)}%`,
        );
      }
      return;
    }
    case 'export': {
      if (args.dryRun) console.log(`  Would write JSON snapshots to ${event.export.dir}`);
      else console.log(`  ${event.export.dir} (reveal policy: ${event.export.revealPolicy})`);
    }
  }
}

function onEvent(event: WeekRunEvent): void {
  if (event.type === 'step') {
    console.log(`\n[${event.index}/${totalSteps}] ${event.label}`);
    return;
  }
  if (event.type === 'step-result') {
    renderStepResult(event);
    return;
  }
  const percent = Math.floor((event.completed / event.total) * 100);
  if (percent !== lastReportedPercent && percent % 10 === 0) {
    lastReportedPercent = percent;
    process.stderr.write(`\r  simulating... ${percent}%`);
  }
}

const result = await runWeek(repo, { ...args, onEvent }).catch((error: unknown) => {
  clearProgressLine();
  if (error instanceof RemoteResultsChangedError) {
    console.error(
      `\nThe remote has changed ${error.overwritten} result(s) that were already recorded.\n` +
        'That is usually a corrected scoreline, but it silently rewrites recorded history and\n' +
        'the grades of every past projection. Review with:\n\n' +
        '  npm run fetch:results -- --dry-run\n\n' +
        'then re-run with --force to accept the changes.',
    );
    process.exit(1);
  }
  throw error;
});

// ----------------------------------------------------------------------- next

console.log(`\n[${totalSteps}/${totalSteps}] Next`);

if (result.dryRun) {
  console.log('  Dry run — nothing was written. Re-run without --dry-run to apply.');
} else {
  const today = new Date().toISOString().slice(0, 10);
  console.log(
    '  The database is gitignored, so commit the results — with the pre-season teams.csv\n' +
      '  they are the recoverable record of what was known this week:\n\n' +
      '    git add data/fixtures.csv\n' +
      `    git commit -m "Results and ratings as of ${today}"\n`,
  );
}
