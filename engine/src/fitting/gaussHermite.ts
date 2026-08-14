/**
 * Gauss-Hermite quadrature, used to integrate out the per-match latent form shocks.
 *
 * The shocks are log-normal, so on the log scale they are Gaussian and a Gauss-Hermite rule
 * integrates them to machine precision with a couple of dozen nodes — far cheaper than
 * sampling them, and deterministic, which matters when an optimiser is comparing likelihoods
 * that differ in the fourth decimal.
 */

/** pi^(-1/4), the leading coefficient of the normalised Hermite recurrence. */
const PI_MINUS_QUARTER = 0.7511255444649425;
const NEWTON_TOLERANCE = 3e-14;
const MAX_NEWTON_ITERATIONS = 20;

export interface QuadratureRule {
  /** Evaluation points. */
  points: number[];
  /** Weights, summing to 1 for {@link normalQuadrature}. */
  weights: number[];
}

/**
 * Nodes and weights for `integral of exp(-x^2) f(x) dx` over the whole real line.
 * Weights sum to sqrt(pi).
 *
 * Roots of the physicists' Hermite polynomial found by Newton's method from the standard
 * asymptotic starting guesses; the polynomial is evaluated through its normalised recurrence
 * so that high node counts do not overflow.
 */
export function gaussHermiteRule(nodeCount: number): QuadratureRule {
  if (!Number.isInteger(nodeCount) || nodeCount < 1) {
    throw new Error(`Node count must be a positive integer, got ${nodeCount}`);
  }

  const points = new Array<number>(nodeCount).fill(0);
  const weights = new Array<number>(nodeCount).fill(0);
  const half = Math.floor((nodeCount + 1) / 2);

  let z = 0;
  let derivative = 0;

  for (let i = 0; i < half; i++) {
    if (i === 0) {
      z = Math.sqrt(2 * nodeCount + 1) - 1.85575 * (2 * nodeCount + 1) ** -0.16667;
    } else if (i === 1) {
      z -= (1.14 * nodeCount ** 0.426) / z;
    } else if (i === 2) {
      z = 1.86 * z - 0.86 * points[0]!;
    } else if (i === 3) {
      z = 1.91 * z - 0.91 * points[1]!;
    } else {
      z = 2 * z - points[i - 2]!;
    }

    for (let iteration = 0; iteration < MAX_NEWTON_ITERATIONS; iteration++) {
      let p1 = PI_MINUS_QUARTER;
      let p2 = 0;
      for (let j = 1; j <= nodeCount; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = z * Math.sqrt(2 / j) * p2 - Math.sqrt((j - 1) / j) * p3;
      }
      derivative = Math.sqrt(2 * nodeCount) * p2;
      const step = p1 / derivative;
      z -= step;
      if (Math.abs(step) <= NEWTON_TOLERANCE) break;
    }

    // Roots are found largest-first, and the starting guesses above chain off the previous
    // positive roots, so the positive value has to be the one stored at `i`.
    points[i] = z;
    points[nodeCount - 1 - i] = -z;
    weights[i] = 2 / (derivative * derivative);
    weights[nodeCount - 1 - i] = weights[i]!;
  }

  return { points, weights };
}

/**
 * Nodes and weights approximating `integral of f(x) N(x; mean, sd^2) dx` as a weighted sum.
 * Weights sum to 1. An `sd` of zero collapses to the single point `mean`.
 */
export function normalQuadrature(nodeCount: number, mean: number, sd: number): QuadratureRule {
  if (sd === 0) return { points: [mean], weights: [1] };
  if (sd < 0) throw new Error(`Standard deviation must be non-negative, got ${sd}`);

  const { points, weights } = gaussHermiteRule(nodeCount);
  const normaliser = 1 / Math.sqrt(Math.PI);
  return {
    points: points.map((x) => mean + Math.SQRT2 * sd * x),
    weights: weights.map((w) => w * normaliser),
  };
}
