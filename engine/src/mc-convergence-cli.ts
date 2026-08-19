import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { calibratedPicksFor } from './engine/calibratedPicks.js';
import { seededRandomSource } from './engine/rng.js';
import type { Fixture } from './engine/types.js';
import { runMonteCarlo, type MonteCarloResult } from './simulation/monteCarlo.js';

/**
 * How many runs is enough?
 *
 * A Monte Carlo batch reports probabilities it estimated by counting, so every number it
 * prints carries sampling error. This measures that error directly: run the same batch several
 * times with different seeds and see how far the answers move. Where they barely move, the
 * extra runs are buying nothing.
 *
 * Two different questions get measured, because they have different answers. The probabilities
 * converge as 1/sqrt(runs) and are usually settled early. The *displayed picks* are a
 * different matter — a fixture whose top two scorelines are near-tied will flip between
 * batches long after its probabilities have stopped moving, and a flipped pick is the thing a
 * reader actually notices.
 */

interface Args {
  runCounts: number[];
  batches: number;
  seed: number;
  dbPath?: string;
  json: boolean;
  eloDeltaWeight?: number;
  upsetVariance?: number;
}

const USAGE = `Measure how much a Monte Carlo batch's answers move between seeds.

  npm run mc:convergence -- [options]

  --runs <list>     Comma-separated run counts (default 1000,2500,5000,10000,25000)
  --batches <N>     Independent batches per run count (default 5)
  --seed <N>        Base seed; batch b uses seed + b (default 1)
  --weight <w>      Season Elo delta weight (default: the stored setting)
  --upset <v>       Upset variance (default: the stored setting)
  --json            Emit the measurements as JSON
  --db <path>       Database path`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    runCounts: [1000, 2500, 5000, 10_000, 25_000],
    batches: 5,
    seed: 1,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs' && argv[i + 1]) {
      args.runCounts = argv[++i]!.split(',').map((value) => Number(value.trim()));
    } else if (argv[i] === '--batches' && argv[i + 1]) args.batches = Number(argv[++i]);
    else if (argv[i] === '--seed' && argv[i + 1]) args.seed = Number(argv[++i]);
    else if (argv[i] === '--weight' && argv[i + 1]) args.eloDeltaWeight = Number(argv[++i]);
    else if (argv[i] === '--upset' && argv[i + 1]) args.upsetVariance = Number(argv[++i]);
    else if (argv[i] === '--db' && argv[i + 1]) args.dbPath = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${argv[i]}\n\n${USAGE}`);
      process.exit(1);
    }
  }

  if (args.runCounts.some((n) => !Number.isFinite(n) || n < 1)) {
    console.error('--runs must be positive integers');
    process.exit(1);
  }
  if (!Number.isFinite(args.batches) || args.batches < 2) {
    console.error('--batches must be at least 2 — spread needs something to compare');
    process.exit(1);
  }
  return args;
}

/** Sample standard deviation. n-1: these are samples of a process, not a whole population. */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Run-to-run spread of one quantity, pooled across the 20 clubs.
 *
 * Pooled rather than worst-of: with a handful of batches each team's SD is itself a noisy
 * estimate, and taking the maximum of 20 noisy estimates selects for the luckiest error, which
 * biases the answer upward and makes it jump around between run counts. Averaging the
 * variances first and rooting once gives an estimator with 20x the data behind it.
 */
function pooledSpread(
  batches: MonteCarloResult[],
  pick: (team: MonteCarloResult['teams'][number]) => number,
): { rms: number; worst: number } {
  const byTeam = new Map<number, number[]>();
  for (const batch of batches) {
    for (const team of batch.teams) {
      const values = byTeam.get(team.teamId) ?? [];
      values.push(pick(team));
      byTeam.set(team.teamId, values);
    }
  }
  const perTeam = [...byTeam.values()].map(standardDeviation);
  const meanVariance = perTeam.reduce((sum, sd) => sum + sd * sd, 0) / perTeam.length;
  return { rms: Math.sqrt(meanVariance), worst: Math.max(...perTeam) };
}

function picksFor(
  batch: MonteCarloResult,
  unplayed: Fixture[],
): Map<number, { goalsHome: number; goalsAway: number }> {
  const distributions = new Map(
    batch.matchDistributions.map((dist) => [
      dist.matchNumber,
      { outcomes: dist.outcomes, scorelines: dist.scorelines },
    ]),
  );
  return calibratedPicksFor(unplayed, distributions);
}

function outcomeOf(pick: { goalsHome: number; goalsAway: number }): number {
  return Math.sign(pick.goalsHome - pick.goalsAway);
}

/** Mean disagreement between every pair of batches, as a share of unplayed fixtures. */
function pickFlipRates(
  batches: MonteCarloResult[],
  unplayed: Fixture[],
): { scoreline: number; outcome: number } {
  const picks = batches.map((batch) => picksFor(batch, unplayed));
  let scorelineDiffs = 0;
  let outcomeDiffs = 0;
  let comparisons = 0;

  for (let a = 0; a < picks.length; a++) {
    for (let b = a + 1; b < picks.length; b++) {
      for (const fixture of unplayed) {
        const left = picks[a]!.get(fixture.matchNumber);
        const right = picks[b]!.get(fixture.matchNumber);
        if (!left || !right) continue;
        comparisons += 1;
        if (left.goalsHome !== right.goalsHome || left.goalsAway !== right.goalsAway) {
          scorelineDiffs += 1;
        }
        if (outcomeOf(left) !== outcomeOf(right)) outcomeDiffs += 1;
      }
    }
  }

  if (comparisons === 0) return { scoreline: 0, outcome: 0 };
  return { scoreline: scorelineDiffs / comparisons, outcome: outcomeDiffs / comparisons };
}

interface Measurement {
  runs: number;
  titleSd: number;
  titleSdWorst: number;
  topFourSd: number;
  relegationSd: number;
  pointsSd: number;
  scorelineFlipRate: number;
  outcomeFlipRate: number;
  meanElapsedMs: number;
}

/**
 * What counts as converged. Stated up front so the recommendation is a reading of a rule
 * rather than a judgement call — disagree with the thresholds and you can re-read the table.
 *
 * Only the probabilities are gated. Pick-flip rates are reported but deliberately not a
 * threshold: they are dominated by genuine near-ties rather than by sampling error, so
 * demanding a low flip rate would demand run counts that buy nothing else. See the
 * "Run count and convergence" section of specs/monte-carlo.md.
 */
const THRESHOLDS = {
  titleSd: 0.005,
  relegationSd: 0.005,
  pointsSd: 0.25,
};

function meetsThresholds(row: Measurement): boolean {
  return (
    row.titleSd < THRESHOLDS.titleSd &&
    row.relegationSd < THRESHOLDS.relegationSd &&
    row.pointsSd < THRESHOLDS.pointsSd
  );
}

const args = parseArgs(process.argv.slice(2));
const { db } = openDatabase(args.dbPath);
const repo = new Repository(db);

const teams = repo.getTeams();
if (teams.length === 0) {
  console.error('No teams found. Run `npm run seed` first.');
  process.exit(1);
}

const fixtures = repo.getFixtures();
const lockedResults = repo.getActualResultsByMatch();
const unplayed = fixtures.filter((fixture) => !lockedResults.has(fixture.matchNumber));
const settings = repo.getSettings();
const eloDeltaWeight = args.eloDeltaWeight ?? settings.seasonEloDeltaWeight;
const upsetVariance = args.upsetVariance ?? settings.upsetVariance;

if (!args.json) {
  console.log(
    `Measuring ${args.batches} batches per run count over ${unplayed.length} unplayed ` +
      `fixtures (${lockedResults.size} locked).`,
  );
  console.log(`Elo delta weight ${eloDeltaWeight}, upset variance ${upsetVariance}.\n`);
}

const measurements: Measurement[] = [];

for (const runs of args.runCounts) {
  const batches: MonteCarloResult[] = [];
  for (let batch = 0; batch < args.batches; batch++) {
    if (!args.json) {
      process.stderr.write(`\r  ${runs} runs, batch ${batch + 1}/${args.batches}...`);
    }
    batches.push(
      await runMonteCarlo(teams, fixtures, {
        runs,
        upsetVariance,
        eloDeltaWeight,
        lockedResults,
        rng: seededRandomSource(args.seed + batch),
        // Reservoir sampling draws from the same stream that drives the matches, so leaving
        // it on would make batches at different run counts incomparable.
        reservoirSize: 0,
      }),
    );
  }
  if (!args.json) process.stderr.write('\r\x1b[K');

  const flips = pickFlipRates(batches, unplayed);
  const title = pooledSpread(batches, (team) => team.titleProbability);
  measurements.push({
    runs,
    titleSd: title.rms,
    titleSdWorst: title.worst,
    topFourSd: pooledSpread(batches, (team) => team.championsLeagueProbability).rms,
    relegationSd: pooledSpread(batches, (team) => team.relegationProbability).rms,
    pointsSd: pooledSpread(batches, (team) => team.averagePoints).rms,
    scorelineFlipRate: flips.scoreline,
    outcomeFlipRate: flips.outcome,
    meanElapsedMs:
      batches.reduce((sum, batch) => sum + batch.elapsedMs, 0) / batches.length,
  });
}

const recommended = measurements.find(meetsThresholds);

if (args.json) {
  console.log(
    JSON.stringify(
      {
        batches: args.batches,
        seed: args.seed,
        eloDeltaWeight,
        upsetVariance,
        lockedFixtures: lockedResults.size,
        unplayedFixtures: unplayed.length,
        thresholds: THRESHOLDS,
        recommendedRuns: recommended?.runs ?? null,
        measurements,
      },
      null,
      2,
    ),
  );
} else {
  const pp = (value: number) => `${(value * 100).toFixed(2)}pp`.padStart(9);
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`.padStart(9);

  console.log('   Runs   title SD    top4 SD   releg SD    pts SD   score flip    out flip      ms');
  console.log('-'.repeat(88));
  for (const row of measurements) {
    console.log(
      `${row.runs.toLocaleString().padStart(7)}  ${pp(row.titleSd)}  ${pp(row.topFourSd)}  ` +
        `${pp(row.relegationSd)}  ${row.pointsSd.toFixed(2).padStart(8)}  ` +
        `${pct(row.scorelineFlipRate)}  ${pct(row.outcomeFlipRate)}  ` +
        `${Math.round(row.meanElapsedMs).toLocaleString().padStart(6)}`,
    );
  }
  console.log('-'.repeat(88));
  console.log(
    '\nSDs are pooled across the 20 clubs. Flip rates are the mean share of unplayed\n' +
      'fixtures where two batches disagree on the displayed pick — reported, not gated:\n' +
      'they are driven by near-ties in the distribution, not by sampling error.',
  );
  console.log(
    `\nConverged means: title SD < ${(THRESHOLDS.titleSd * 100).toFixed(1)}pp, ` +
      `relegation SD < ${(THRESHOLDS.relegationSd * 100).toFixed(1)}pp, ` +
      `points SD < ${THRESHOLDS.pointsSd}.`,
  );
  console.log(
    recommended
      ? `Smallest run count tested that meets all three: ${recommended.runs.toLocaleString()}.`
      : 'No run count tested met all three — try larger values.',
  );
}
