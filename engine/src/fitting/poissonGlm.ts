/**
 * Poisson regression with a log link, fitted by iteratively reweighted least squares.
 *
 * The log-likelihood of a log-link Poisson GLM is concave in the coefficients, so Newton's
 * method converges to the global optimum from any sane start — there are no local optima to
 * worry about and no learning rate to tune.
 */

export interface PoissonGlmFit {
  /** Coefficients, one per design-matrix column. */
  beta: number[];
  /** Standard errors from the inverse Fisher information at the optimum. */
  standardErrors: number[];
  /** Full Poisson log-likelihood, including the log(y!) term. */
  logLikelihood: number;
  iterations: number;
  converged: boolean;
}

export interface PoissonGlmOptions {
  maxIterations?: number;
  /** Convergence threshold on the largest absolute coefficient change. */
  tolerance?: number;
}

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_TOLERANCE = 1e-10;

/** log(y!) for the small non-negative integers a goal count can be. */
function logFactorial(y: number): number {
  let total = 0;
  for (let i = 2; i <= y; i++) total += Math.log(i);
  return total;
}

/**
 * Solves `A x = b` for symmetric positive-definite A by Gauss-Jordan elimination with
 * partial pivoting, returning both the solution and the inverse of A (the covariance
 * matrix, once A is the Fisher information).
 */
function solveWithInverse(
  a: number[][],
  b: number[],
): { solution: number[]; inverse: number[][] } | null {
  const n = b.length;
  // Work on [A | I | b] so one elimination pass yields both the inverse and the solution.
  const m = a.map((row, i) => {
    const identity = Array.from({ length: n }, (_, j) => (i === j ? 1 : 0));
    return [...row, ...identity, b[i]!];
  });

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivotRow]![col]!)) pivotRow = row;
    }
    const pivot = m[pivotRow]![col]!;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-12) return null;

    if (pivotRow !== col) {
      const swap = m[pivotRow]!;
      m[pivotRow] = m[col]!;
      m[col] = swap;
    }

    const pivotRowValues = m[col]!;
    for (let j = col; j < 2 * n + 1; j++) pivotRowValues[j] = pivotRowValues[j]! / pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j < 2 * n + 1; j++) {
        m[row]![j] = m[row]![j]! - factor * pivotRowValues[j]!;
      }
    }
  }

  return {
    solution: m.map((row) => row[2 * n]!),
    inverse: m.map((row) => row.slice(n, 2 * n)),
  };
}

export function poissonLogLikelihood(x: number[][], y: number[], beta: number[]): number {
  let total = 0;
  for (let i = 0; i < y.length; i++) {
    const row = x[i]!;
    let eta = 0;
    for (let j = 0; j < beta.length; j++) eta += row[j]! * beta[j]!;
    total += y[i]! * eta - Math.exp(eta) - logFactorial(y[i]!);
  }
  return total;
}

/**
 * Fits `log E[y] = X beta`.
 *
 * @param x Design matrix; include an explicit column of ones for an intercept.
 * @param y Non-negative integer counts, one per row of `x`.
 */
export function fitPoissonLog(
  x: number[][],
  y: number[],
  options: PoissonGlmOptions = {},
): PoissonGlmFit {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;

  if (x.length !== y.length) {
    throw new Error(`Design matrix has ${x.length} rows but ${y.length} responses`);
  }
  if (x.length === 0) throw new Error('Cannot fit a Poisson GLM with no observations');

  const parameterCount = x[0]!.length;
  const beta = new Array<number>(parameterCount).fill(0);
  // Start the intercept at log(mean y) when column 0 is the conventional ones column, so the
  // first Newton step begins from a model that already predicts the right overall level.
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  if (parameterCount > 0 && x.every((row) => row[0] === 1)) {
    beta[0] = Math.log(Math.max(meanY, 1e-6));
  }

  let converged = false;
  let iterations = 0;
  let covariance: number[][] | null = null;

  for (; iterations < maxIterations; iterations++) {
    const gradient = new Array<number>(parameterCount).fill(0);
    const information = Array.from({ length: parameterCount }, () =>
      new Array<number>(parameterCount).fill(0),
    );

    for (let i = 0; i < y.length; i++) {
      const row = x[i]!;
      let eta = 0;
      for (let j = 0; j < parameterCount; j++) eta += row[j]! * beta[j]!;
      const lambda = Math.exp(eta);
      const residual = y[i]! - lambda;

      for (let j = 0; j < parameterCount; j++) {
        gradient[j] = gradient[j]! + row[j]! * residual;
        for (let k = j; k < parameterCount; k++) {
          information[j]![k] = information[j]![k]! + lambda * row[j]! * row[k]!;
        }
      }
    }
    // The information matrix is symmetric; only the upper triangle was accumulated.
    for (let j = 0; j < parameterCount; j++) {
      for (let k = 0; k < j; k++) information[j]![k] = information[k]![j]!;
    }

    const solved = solveWithInverse(information, gradient);
    if (!solved) break;

    covariance = solved.inverse;
    let maxStep = 0;
    for (let j = 0; j < parameterCount; j++) {
      beta[j] = beta[j]! + solved.solution[j]!;
      maxStep = Math.max(maxStep, Math.abs(solved.solution[j]!));
    }

    if (maxStep < tolerance) {
      converged = true;
      iterations += 1;
      break;
    }
  }

  const standardErrors = covariance
    ? covariance.map((row, j) => Math.sqrt(Math.max(row[j]!, 0)))
    : new Array<number>(parameterCount).fill(Number.NaN);

  return {
    beta,
    standardErrors,
    logLikelihood: poissonLogLikelihood(x, y, beta),
    iterations,
    converged,
  };
}
