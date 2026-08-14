/**
 * Likelihood of the engine's actual generative model: Poisson goals whose rates carry a
 * shared "tempo" shock and a differential "form" shock, with a Dixon-Coles correction on the
 * low-scoring cells.
 *
 * Writing the shocks on the log scale makes both Gaussian, so the two-dimensional integral
 * that turns them into a per-match probability is a product of Gauss-Hermite rules rather
 * than a simulation. This is the exact likelihood of what {@link simulateMatchOutcome}
 * samples, which is what lets a fit here transfer straight into the simulator.
 *
 * Mean structure is deliberately not re-estimated. Every shock is mean-1 and the Dixon-Coles
 * tau preserves both marginals, so `E[goals]` is still the stage-1 mean and those
 * coefficients stay valid — that is the whole reason the fit splits into two stages.
 */
import { normalQuadrature } from './gaussHermite.js';

export interface ShapeParameters {
  /** Log-normal sigma for per-team match form; matches `upsetVariance`. */
  sigma: number;
  /** Share of the form variance that is common to both sides; matches `tempoShare`. */
  tempoShare: number;
  /** Dixon-Coles low-score correlation. Zero leaves the Poisson cells untouched. */
  rho: number;
}

export const INDEPENDENT_POISSON: ShapeParameters = { sigma: 0, tempoShare: 0, rho: 0 };

/** Nodes per latent dimension. Twenty is well past convergence for these smooth integrands. */
export const DEFAULT_NODE_COUNT = 20;

/**
 * Tau keeps total probability and both marginals exactly intact, so it redistributes mass
 * between the four low-scoring cells without disturbing expected goals.
 */
export function dixonColesTau(
  goalsHome: number,
  goalsAway: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): number {
  if (rho === 0) return 1;
  if (goalsHome === 0 && goalsAway === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (goalsHome === 0 && goalsAway === 1) return 1 + lambdaHome * rho;
  if (goalsHome === 1 && goalsAway === 0) return 1 + lambdaAway * rho;
  if (goalsHome === 1 && goalsAway === 1) return 1 - rho;
  return 1;
}

export interface ShockGrid {
  /** Multiplier applied to the home rate at each node. */
  homeMultiplier: number[];
  awayMultiplier: number[];
  /** Log of the home multiplier, kept to avoid a log inside the per-match loop. */
  logHomeMultiplier: number[];
  logAwayMultiplier: number[];
  weight: number[];
}

/**
 * Quadrature grid for the two shocks.
 *
 * With `T` the shared shock and `F_home / F_away` the differential one, both mean-1
 * log-normals as the simulator draws them:
 *
 *   log lambda_home = log mu_home + U + S - sigmaDiff^2
 *   log lambda_away = log mu_away + U - S - sigmaDiff^2
 *
 * where `U = log T ~ N(-sigmaShared^2/2, sigmaShared^2)` and `S ~ N(0, 2 sigmaDiff^2)` is the
 * log ratio of the two form draws. The `-sigmaDiff^2` offset is the simulator's ratio
 * correction, and it is what holds `E[lambda]` at `mu` for every sigma.
 */
export function buildShockGrid(
  shape: ShapeParameters,
  nodeCount: number = DEFAULT_NODE_COUNT,
): ShockGrid {
  const share = Math.min(1, Math.max(0, shape.tempoShare));
  const sigmaDiff = shape.sigma * Math.sqrt(1 - share);
  const sigmaShared = shape.sigma * Math.sqrt(2 * share);

  const shared = normalQuadrature(nodeCount, -(sigmaShared * sigmaShared) / 2, sigmaShared);
  const differential = normalQuadrature(nodeCount, 0, sigmaDiff * Math.SQRT2);
  const offset = -(sigmaDiff * sigmaDiff);

  const homeMultiplier: number[] = [];
  const awayMultiplier: number[] = [];
  const logHomeMultiplier: number[] = [];
  const logAwayMultiplier: number[] = [];
  const weight: number[] = [];

  for (let i = 0; i < shared.points.length; i++) {
    for (let j = 0; j < differential.points.length; j++) {
      const logHome = shared.points[i]! + differential.points[j]! + offset;
      const logAway = shared.points[i]! - differential.points[j]! + offset;
      logHomeMultiplier.push(logHome);
      logAwayMultiplier.push(logAway);
      homeMultiplier.push(Math.exp(logHome));
      awayMultiplier.push(Math.exp(logAway));
      weight.push(shared.weights[i]! * differential.weights[j]!);
    }
  }

  return { homeMultiplier, awayMultiplier, logHomeMultiplier, logAwayMultiplier, weight };
}

const LOG_FACTORIAL_CACHE: number[] = [0, 0];

function logFactorial(value: number): number {
  for (let i = LOG_FACTORIAL_CACHE.length; i <= value; i++) {
    LOG_FACTORIAL_CACHE.push(LOG_FACTORIAL_CACHE[i - 1]! + Math.log(i));
  }
  return LOG_FACTORIAL_CACHE[value]!;
}

/** Floor for tau, which can go negative for a rho too large for the rates at some node. */
const MIN_TAU = 1e-12;

export interface MatchMeans {
  muHome: number;
  muAway: number;
  goalsHome: number;
  goalsAway: number;
}

/** Log probability of one observed scoreline, integrating the shocks out. */
export function matchLogProbability(
  match: MatchMeans,
  shape: ShapeParameters,
  grid: ShockGrid,
): number {
  const logMuHome = Math.log(match.muHome);
  const logMuAway = Math.log(match.muAway);
  const logFactorials = logFactorial(match.goalsHome) + logFactorial(match.goalsAway);

  let total = 0;
  for (let k = 0; k < grid.weight.length; k++) {
    const lambdaHome = match.muHome * grid.homeMultiplier[k]!;
    const lambdaAway = match.muAway * grid.awayMultiplier[k]!;

    const logPoisson =
      -lambdaHome -
      lambdaAway +
      match.goalsHome * (logMuHome + grid.logHomeMultiplier[k]!) +
      match.goalsAway * (logMuAway + grid.logAwayMultiplier[k]!) -
      logFactorials;

    const tau = dixonColesTau(
      match.goalsHome,
      match.goalsAway,
      lambdaHome,
      lambdaAway,
      shape.rho,
    );

    total += grid.weight[k]! * Math.max(tau, MIN_TAU) * Math.exp(logPoisson);
  }

  return Math.log(Math.max(total, Number.MIN_VALUE));
}

/** Total log-likelihood over a set of matches whose stage-1 means are already computed. */
export function mixedLogLikelihood(
  matches: MatchMeans[],
  shape: ShapeParameters,
  nodeCount: number = DEFAULT_NODE_COUNT,
): number {
  const grid = buildShockGrid(shape, nodeCount);
  let total = 0;
  for (const match of matches) total += matchLogProbability(match, shape, grid);
  return total;
}

/**
 * Full scoreline distribution under the fitted shape, as a `maxGoals+1` square matrix
 * indexed `[home][away]`. Used to read off draw rates and cell probabilities.
 */
export function scorelineMatrix(
  muHome: number,
  muAway: number,
  shape: ShapeParameters,
  maxGoals = 12,
  nodeCount: number = DEFAULT_NODE_COUNT,
): number[][] {
  const grid = buildShockGrid(shape, nodeCount);
  const matrix = Array.from({ length: maxGoals + 1 }, () =>
    new Array<number>(maxGoals + 1).fill(0),
  );

  for (let home = 0; home <= maxGoals; home++) {
    for (let away = 0; away <= maxGoals; away++) {
      matrix[home]![away] = Math.exp(
        matchLogProbability({ muHome, muAway, goalsHome: home, goalsAway: away }, shape, grid),
      );
    }
  }

  return matrix;
}
