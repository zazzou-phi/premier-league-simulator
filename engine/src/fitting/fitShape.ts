/**
 * Fits the distribution-shape parameters — form sigma, tempo share and the Dixon-Coles rho —
 * on top of a mean model that stage 1 already fixed.
 *
 * Three bounded parameters over a smooth likelihood, so a derivative-free simplex search is
 * both sufficient and robust; the likelihood involves a quadrature and has no closed-form
 * gradient worth deriving.
 */
import {
  DEFAULT_NODE_COUNT,
  mixedLogLikelihood,
  type MatchMeans,
  type ShapeParameters,
} from './mixedPoisson.js';

/** Widest rho the search will consider; beyond this tau goes negative at plausible rates. */
export const RHO_BOUND = 0.4;

export interface ShapeFit {
  shape: ShapeParameters;
  logLikelihood: number;
  /** Number of free parameters, for likelihood-ratio comparisons. */
  freeParameters: number;
  evaluations: number;
  converged: boolean;
}

export interface ShapeFitOptions {
  nodeCount?: number;
  /** When false, sigma is pinned at 0 and the tempo share becomes meaningless. */
  fitShocks?: boolean;
  /** When false, rho is pinned at 0. */
  fitRho?: boolean;
  start?: Partial<ShapeParameters>;
  maxEvaluations?: number;
  tolerance?: number;
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

interface NelderMeadResult {
  point: number[];
  value: number;
  evaluations: number;
  converged: boolean;
}

/** Minimises `objective`. Standard simplex with reflection, expansion, contraction, shrink. */
export function nelderMead(
  objective: (point: number[]) => number,
  start: number[],
  options: { maxEvaluations?: number; tolerance?: number; initialStep?: number } = {},
): NelderMeadResult {
  const maxEvaluations = options.maxEvaluations ?? 2000;
  const tolerance = options.tolerance ?? 1e-11;
  const initialStep = options.initialStep ?? 0.5;
  const n = start.length;

  if (n === 0) {
    return { point: [], value: objective([]), evaluations: 1, converged: true };
  }

  let evaluations = 0;
  const evaluate = (point: number[]) => {
    evaluations++;
    const value = objective(point);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };

  const simplex: Array<{ point: number[]; value: number }> = [
    { point: [...start], value: evaluate(start) },
  ];
  for (let i = 0; i < n; i++) {
    const point = [...start];
    point[i] = point[i]! + initialStep;
    simplex.push({ point, value: evaluate(point) });
  }

  let converged = false;
  while (evaluations < maxEvaluations) {
    simplex.sort((a, b) => a.value - b.value);
    const best = simplex[0]!;
    const worst = simplex[n]!;
    const secondWorst = simplex[n - 1]!;

    if (Math.abs(worst.value - best.value) < tolerance) {
      converged = true;
      break;
    }

    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] = centroid[j]! + simplex[i]!.point[j]! / n;
    }

    const combine = (factor: number) =>
      centroid.map((c, j) => c + factor * (c - worst.point[j]!));

    const reflected = combine(1);
    const reflectedValue = evaluate(reflected);

    if (reflectedValue < best.value) {
      const expanded = combine(2);
      const expandedValue = evaluate(expanded);
      simplex[n] =
        expandedValue < reflectedValue
          ? { point: expanded, value: expandedValue }
          : { point: reflected, value: reflectedValue };
    } else if (reflectedValue < secondWorst.value) {
      simplex[n] = { point: reflected, value: reflectedValue };
    } else {
      const contracted = combine(-0.5);
      const contractedValue = evaluate(contracted);
      if (contractedValue < worst.value) {
        simplex[n] = { point: contracted, value: contractedValue };
      } else {
        for (let i = 1; i <= n; i++) {
          const point = simplex[i]!.point.map((x, j) => best.point[j]! + 0.5 * (x - best.point[j]!));
          simplex[i] = { point, value: evaluate(point) };
        }
      }
    }
  }

  simplex.sort((a, b) => a.value - b.value);
  return {
    point: simplex[0]!.point,
    value: simplex[0]!.value,
    evaluations,
    converged,
  };
}

/**
 * Unconstrained search coordinates mapped onto the valid parameter ranges: sigma positive,
 * tempo share in [0, 1], rho inside {@link RHO_BOUND}.
 */
function decode(
  raw: number[],
  fitShocks: boolean,
  fitRho: boolean,
  start: ShapeParameters,
): ShapeParameters {
  let index = 0;
  const sigma = fitShocks ? Math.exp(raw[index++]!) : 0;
  const tempoShare = fitShocks ? logistic(raw[index++]!) : start.tempoShare;
  const rho = fitRho ? RHO_BOUND * Math.tanh(raw[index++]!) : 0;
  return { sigma, tempoShare, rho };
}

export function fitShapeParameters(
  matches: MatchMeans[],
  options: ShapeFitOptions = {},
): ShapeFit {
  const nodeCount = options.nodeCount ?? DEFAULT_NODE_COUNT;
  const fitShocks = options.fitShocks ?? true;
  const fitRho = options.fitRho ?? true;

  const start: ShapeParameters = {
    sigma: options.start?.sigma ?? 0.2,
    tempoShare: options.start?.tempoShare ?? 0.5,
    rho: options.start?.rho ?? 0,
  };

  const rawStart: number[] = [];
  if (fitShocks) {
    rawStart.push(Math.log(Math.max(start.sigma, 1e-3)));
    rawStart.push(logit(Math.min(0.99, Math.max(0.01, start.tempoShare))));
  }
  if (fitRho) {
    rawStart.push(Math.atanh(Math.max(-0.99, Math.min(0.99, start.rho / RHO_BOUND))));
  }

  const objective = (raw: number[]) =>
    -mixedLogLikelihood(matches, decode(raw, fitShocks, fitRho, start), nodeCount);

  const result = nelderMead(objective, rawStart, {
    maxEvaluations: options.maxEvaluations ?? 2000,
    tolerance: options.tolerance ?? 1e-11,
  });

  return {
    shape: decode(result.point, fitShocks, fitRho, start),
    logLikelihood: -result.value,
    freeParameters: (fitShocks ? 2 : 0) + (fitRho ? 1 : 0),
    evaluations: result.evaluations,
    converged: result.converged,
  };
}

export interface ShapeModelComparison {
  label: string;
  fit: ShapeFit;
  /** Mean per-match log-likelihood on the data the model was fitted to. */
  inSample: number;
}

/** Fits the nested family: no shocks, shocks only, rho only, and both. */
export function compareShapeModels(matches: MatchMeans[], nodeCount?: number): ShapeModelComparison[] {
  const variants: Array<{ label: string; fitShocks: boolean; fitRho: boolean }> = [
    { label: 'independent Poisson', fitShocks: false, fitRho: false },
    { label: 'shocks only (sigma, share)', fitShocks: true, fitRho: false },
    { label: 'rho only', fitShocks: false, fitRho: true },
    { label: 'shocks + rho', fitShocks: true, fitRho: true },
  ];

  return variants.map(({ label, fitShocks, fitRho }) => {
    const fit = fitShapeParameters(matches, { fitShocks, fitRho, nodeCount });
    return { label, fit, inSample: fit.logLikelihood / matches.length };
  });
}
