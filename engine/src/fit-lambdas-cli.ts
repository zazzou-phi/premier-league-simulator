import {
  DEFAULT_BASELINE_AWAY,
  DEFAULT_BASELINE_HOME,
  DEFAULT_TEMPO_SHARE,
  DEFAULT_UPSET_VARIANCE,
} from './engine/matchSimulator.js';
import { DEFAULT_SEASON_ELO_K } from './engine/seasonElo.js';
import { compareShapeModels, fitShapeParameters } from './fitting/fitShape.js';
import { loadHistoricalDataset, type SeasonYear } from './fitting/historicalData.js';
import {
  buildTrainingRows,
  chiSquaredUpperTail,
  fitLambdaModel,
  predictMeans,
  rollingOriginEvaluation,
  type SideFit,
  type TrainingRow,
} from './fitting/lambdaModel.js';
import {
  buildShockGrid,
  matchLogProbability,
  mixedLogLikelihood,
  type MatchMeans,
  type ShapeParameters,
} from './fitting/mixedPoisson.js';

const DEFAULT_SEASONS = [2021, 2022, 2023, 2024, 2025];

interface Args {
  seasons: SeasonYear[];
  eloK: number;
  rolling: boolean;
  shape: boolean;
}

function parseArgs(argv: string[]): Args {
  let seasons = DEFAULT_SEASONS;
  let eloK = DEFAULT_SEASON_ELO_K;
  let rolling = true;
  let shape = true;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seasons' && argv[i + 1]) {
      seasons = argv[++i]!.split(',').map((value) => Number(value.trim()));
    } else if (argv[i] === '--elo-k' && argv[i + 1]) {
      eloK = Number(argv[++i]);
    } else if (argv[i] === '--no-rolling') {
      rolling = false;
    } else if (argv[i] === '--no-shape') {
      shape = false;
    }
  }

  if (seasons.some((season) => !Number.isFinite(season))) {
    throw new Error('Invalid --seasons; expected a comma-separated list like 2021,2022');
  }
  if (!Number.isFinite(eloK)) throw new Error('Invalid --elo-k');
  return { seasons, eloK, rolling, shape };
}

function describeSide(label: string, side: SideFit, currentBaseline: number): void {
  const se = side.fit.standardErrors;
  console.log(`  ${label}`);
  console.log(
    `    baseline (even fixture)  ${side.baseline.toFixed(4)}  ` +
      `(engine currently ${currentBaseline})`,
  );
  console.log(
    `    eloDiff coefficient      ${side.eloCoefficient.toFixed(4)} ± ${se[1]!.toFixed(4)}`,
  );
  if (side.driftCoefficient != null) {
    const ratio = Math.abs(side.driftCoefficient / se[2]!);
    console.log(
      `    driftDiff coefficient    ${side.driftCoefficient.toFixed(4)} ± ${se[2]!.toFixed(4)}` +
        `  (|t| = ${ratio.toFixed(2)})`,
    );
    if (side.impliedDriftWeight != null) {
      console.log(`    implied drift weight     ${side.impliedDriftWeight.toFixed(3)}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));

console.log(`Loading seasons ${args.seasons.join(', ')} (cached after first run)...`);
const dataset = await loadHistoricalDataset({ seasons: args.seasons });
const rows = buildTrainingRows(dataset, { eloK: args.eloK });

console.log(
  `\n${rows.length} matches, ${dataset.eloHistory.size} clubs, drift replayed at K=${args.eloK}.\n`,
);

const fit = fitLambdaModel(rows, true);

console.log('In-sample fit (option C: clubelo point-in-time Elo + free in-season drift)');
describeSide('home', fit.home, DEFAULT_BASELINE_HOME);
describeSide('away', fit.away, DEFAULT_BASELINE_AWAY);

if (fit.driftTest) {
  console.log(
    `\n  drift likelihood-ratio test: chi2(${fit.driftTest.degreesOfFreedom}) = ` +
      `${fit.driftTest.statistic.toFixed(2)}, p = ${fit.driftTest.pValue.toExponential(2)}`,
  );
}

if (args.rolling) {
  console.log('\nRolling-origin evaluation (walk-forward by matchday)...');
  const rolling = rollingOriginEvaluation(rows);
  const delta = rolling.withDrift - rolling.withoutDrift;
  console.log(`  origins scored          ${rolling.evaluated} of ${rolling.origins}`);
  console.log(`  mean log-lik with drift    ${rolling.withDrift.toFixed(5)}`);
  console.log(`  mean log-lik without drift ${rolling.withoutDrift.toFixed(5)}`);
  console.log(
    `  difference                 ${delta >= 0 ? '+' : ''}${delta.toFixed(5)} ` +
      `(${delta >= 0 ? 'drift helps' : 'drift hurts'} out of sample)`,
  );
}

if (args.shape) {
  // Stage 1 found drift neither significant nor helpful out of sample, so the mean model the
  // shape parameters sit on top of is the one without it.
  const meanFit = fitLambdaModel(rows, false);
  const means = predictMeans(meanFit, rows, false);

  const observedDraws = rows.filter((row) => row.goalsHome === row.goalsAway).length;

  /** Model-implied draw rate: sum of the diagonal, averaged over the real fixture list. */
  function impliedDrawRate(shape: ShapeParameters, matches: MatchMeans[]): number {
    const grid = buildShockGrid(shape);
    let total = 0;
    for (const match of matches) {
      for (let goals = 0; goals <= 10; goals++) {
        total += Math.exp(
          matchLogProbability({ ...match, goalsHome: goals, goalsAway: goals }, shape, grid),
        );
      }
    }
    return total / matches.length;
  }

  console.log('\n\nStage 2 — distribution shape on the drift-free mean model');
  console.log(`  observed draw rate ${((observedDraws / rows.length) * 100).toFixed(2)}%\n`);

  const comparisons = compareShapeModels(means);
  console.log('  model                        sigma   share     rho    mean ll   draw%');
  for (const { label, fit, inSample } of comparisons) {
    const drawRate = impliedDrawRate(fit.shape, means);
    console.log(
      `  ${label.padEnd(27)} ${fit.shape.sigma.toFixed(3)}   ${fit.shape.tempoShare.toFixed(3)}  ` +
        `${fit.shape.rho >= 0 ? ' ' : ''}${fit.shape.rho.toFixed(3)}   ${inSample.toFixed(5)}  ` +
        `${(drawRate * 100).toFixed(2)}%`,
    );
  }

  const byLabel = new Map(comparisons.map((c) => [c.label, c]));
  const nullModel = byLabel.get('independent Poisson')!;
  const rhoOnly = byLabel.get('rho only')!;
  const shocksOnly = byLabel.get('shocks only (sigma, share)')!;
  const full = byLabel.get('shocks + rho')!;

  const lr = (a: typeof nullModel, b: typeof nullModel) =>
    2 * (b.fit.logLikelihood - a.fit.logLikelihood);

  console.log('\n  Likelihood-ratio tests');
  const rhoStat = lr(nullModel, rhoOnly);
  console.log(
    `    rho alone            chi2(1) = ${rhoStat.toFixed(2)}, ` +
      `p = ${chiSquaredUpperTail(rhoStat, 1).toExponential(2)}`,
  );
  const rhoOnTopStat = lr(shocksOnly, full);
  console.log(
    `    rho given shocks     chi2(1) = ${rhoOnTopStat.toFixed(2)}, ` +
      `p = ${chiSquaredUpperTail(rhoOnTopStat, 1).toExponential(2)}`,
  );
  console.log(
    `    shocks alone         chi2 stat = ${lr(nullModel, shocksOnly).toFixed(2)} ` +
      '(no valid p-value: sigma = 0 sits on the boundary and the share is unidentified there)',
  );

  // Out-of-sample: fit the shape on every season but the last, score the last.
  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b);
  const holdoutSeason = seasons.at(-1)!;
  const isHoldout = (row: TrainingRow) => row.season === holdoutSeason;
  const trainRows = rows.filter((row) => !isHoldout(row));
  const testRows = rows.filter(isHoldout);

  if (trainRows.length > 0 && testRows.length > 0) {
    const trainFit = fitLambdaModel(trainRows, false);
    const trainMeans = predictMeans(trainFit, trainRows, false);
    const testMeans = predictMeans(trainFit, testRows, false);

    console.log(`\n  Held-out season ${holdoutSeason} (${testRows.length} matches), shape fitted on the rest`);
    console.log('  model                        mean ll');
    for (const { label, fit } of [
      { label: 'independent Poisson', fit: { shape: { sigma: 0, tempoShare: 0, rho: 0 } } },
      {
        label: 'shocks only (sigma, share)',
        fit: fitShapeParameters(trainMeans, { fitRho: false }),
      },
      { label: 'rho only', fit: fitShapeParameters(trainMeans, { fitShocks: false }) },
      { label: 'shocks + rho', fit: fitShapeParameters(trainMeans) },
      {
        label: `engine default (${DEFAULT_UPSET_VARIANCE}, ${DEFAULT_TEMPO_SHARE})`,
        fit: {
          shape: {
            sigma: DEFAULT_UPSET_VARIANCE,
            tempoShare: DEFAULT_TEMPO_SHARE,
            rho: 0,
          },
        },
      },
    ]) {
      const value = mixedLogLikelihood(testMeans, fit.shape) / testMeans.length;
      console.log(`  ${label.padEnd(27)} ${value.toFixed(5)}`);
    }
  }
}
