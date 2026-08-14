import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASELINE_AWAY,
  DEFAULT_BASELINE_HOME,
  simulateMatchOutcome,
} from '../src/engine/matchSimulator.js';
import { gaussHermiteRule, normalQuadrature } from '../src/fitting/gaussHermite.js';
import {
  buildShockGrid,
  dixonColesTau,
  matchLogProbability,
  mixedLogLikelihood,
  scorelineMatrix,
  INDEPENDENT_POISSON,
  type ShapeParameters,
} from '../src/fitting/mixedPoisson.js';
import { fitShapeParameters, nelderMead } from '../src/fitting/fitShape.js';
import { testRng } from './testRng.js';

const team = (id: number, elo: number) => ({ id, name: `T${id}`, shortName: `T${id}`, elo });

/**
 * Deterministic but well-distributed PRNG (mulberry32).
 *
 * `testRng` is a bare LCG whose consecutive outputs are linearly related, which degenerates
 * Box-Muller: the form shocks it produces are not actually log-normal, so a parameter
 * recovery test built on it fails no matter how correct the fitter is.
 */
function goodRng(seed: number) {
  let a = seed >>> 0;
  return {
    random: () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

describe('gaussHermiteRule', () => {
  it('has weights summing to sqrt(pi)', () => {
    for (const n of [4, 10, 20, 40]) {
      const { weights } = gaussHermiteRule(n);
      const total = weights.reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(Math.sqrt(Math.PI), 10);
    }
  });

  it('places nodes symmetrically about zero', () => {
    const { points } = gaussHermiteRule(11);
    for (let i = 0; i < points.length; i++) {
      expect(points[i]!).toBeCloseTo(-points[points.length - 1 - i]!, 12);
    }
  });

  it('rejects a non-positive node count', () => {
    expect(() => gaussHermiteRule(0)).toThrow(/positive integer/);
  });
});

describe('normalQuadrature', () => {
  const integrate = (n: number, mean: number, sd: number, f: (x: number) => number) => {
    const { points, weights } = normalQuadrature(n, mean, sd);
    return points.reduce((sum, x, i) => sum + weights[i]! * f(x), 0);
  };

  it('integrates the moments of a normal density', () => {
    const mean = 0.35;
    const sd = 0.8;
    expect(integrate(24, mean, sd, () => 1)).toBeCloseTo(1, 12);
    expect(integrate(24, mean, sd, (x) => x)).toBeCloseTo(mean, 12);
    expect(integrate(24, mean, sd, (x) => (x - mean) ** 2)).toBeCloseTo(sd * sd, 12);
  });

  it('integrates the log-normal mean, which is what the mean-1 rescaling relies on', () => {
    const sd = 0.45;
    // E[exp(X)] for X ~ N(-sd^2/2, sd^2) is exactly 1.
    expect(integrate(24, -(sd * sd) / 2, sd, Math.exp)).toBeCloseTo(1, 10);
  });

  it('collapses to a single point when the spread is zero', () => {
    expect(normalQuadrature(20, 1.5, 0)).toEqual({ points: [1.5], weights: [1] });
  });
});

describe('dixonColesTau', () => {
  it('leaves every cell alone when rho is zero', () => {
    for (let h = 0; h <= 3; h++) {
      for (let a = 0; a <= 3; a++) {
        expect(dixonColesTau(h, a, 1.5, 1.2, 0)).toBe(1);
      }
    }
  });

  it('preserves total probability and both marginals', () => {
    const lambdaHome = 1.4;
    const lambdaAway = 1.1;
    const rho = 0.08;
    const pois = (k: number, lambda: number) => {
      let p = Math.exp(-lambda);
      for (let i = 1; i <= k; i++) p *= lambda / i;
      return p;
    };

    // The correction only touches the four cells with both scores at most one, so the change
    // it makes to the total and to each marginal must cancel within those cells.
    let totalShift = 0;
    let homeZeroShift = 0;
    let awayZeroShift = 0;
    for (const [h, a] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      const base = pois(h, lambdaHome) * pois(a, lambdaAway);
      const shift = base * (dixonColesTau(h, a, lambdaHome, lambdaAway, rho) - 1);
      totalShift += shift;
      if (h === 0) homeZeroShift += shift;
      if (a === 0) awayZeroShift += shift;
    }

    expect(totalShift).toBeCloseTo(0, 12);
    expect(homeZeroShift).toBeCloseTo(0, 12);
    expect(awayZeroShift).toBeCloseTo(0, 12);
  });
});

describe('mixed Poisson likelihood', () => {
  it('reduces to independent Poisson when there are no shocks and no rho', () => {
    const grid = buildShockGrid(INDEPENDENT_POISSON);
    const muHome = 1.6;
    const muAway = 1.3;
    const pois = (k: number, lambda: number) => {
      let p = Math.exp(-lambda);
      for (let i = 1; i <= k; i++) p *= lambda / i;
      return p;
    };

    for (const [h, a] of [
      [0, 0],
      [2, 1],
      [3, 3],
      [5, 0],
    ] as const) {
      const value = matchLogProbability(
        { muHome, muAway, goalsHome: h, goalsAway: a },
        INDEPENDENT_POISSON,
        grid,
      );
      expect(Math.exp(value)).toBeCloseTo(pois(h, muHome) * pois(a, muAway), 12);
    }
  });

  it('keeps expected goals on the stage-1 mean for any sigma and share', () => {
    for (const shape of [
      { sigma: 0.2, tempoShare: 0, rho: 0 },
      { sigma: 0.35, tempoShare: 0.6, rho: 0 },
      { sigma: 0.5, tempoShare: 1, rho: 0 },
      { sigma: 0.3, tempoShare: 0.4, rho: 0.05 },
    ] satisfies ShapeParameters[]) {
      const matrix = scorelineMatrix(1.7, 1.25, shape, 35);
      let total = 0;
      let meanHome = 0;
      let meanAway = 0;
      for (let h = 0; h < matrix.length; h++) {
        for (let a = 0; a < matrix.length; a++) {
          total += matrix[h]![a]!;
          meanHome += h * matrix[h]![a]!;
          meanAway += a * matrix[h]![a]!;
        }
      }
      // Not exact: the matrix is truncated, and the largest shared shock here still leaves a
      // little mass past 35 goals. The residual is truncation, not quadrature — the numbers
      // are unchanged from 20 nodes up to 80.
      expect(total).toBeCloseTo(1, 3);
      expect(meanHome).toBeCloseTo(1.7, 3);
      expect(meanAway).toBeCloseTo(1.25, 3);
    }
  });

  it('agrees with the simulator it is the likelihood of', () => {
    // The whole point of the stage-2 parameterisation is that this analytic distribution and
    // simulateMatchOutcome describe the same generative process.
    const shape: ShapeParameters = { sigma: 0.35, tempoShare: 0.6, rho: 0 };
    const matrix = scorelineMatrix(DEFAULT_BASELINE_HOME, DEFAULT_BASELINE_AWAY, shape, 14);

    const rng = testRng(99);
    const runs = 200_000;
    const counts = new Map<string, number>();
    let draws = 0;
    for (let i = 0; i < runs; i++) {
      const outcome = simulateMatchOutcome(team(1, 1800), team(2, 1800), {
        upsetVariance: shape.sigma,
        tempoShare: shape.tempoShare,
        rng,
      });
      if (outcome.goalsHome === outcome.goalsAway) draws++;
      const key = `${outcome.goalsHome}-${outcome.goalsAway}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    let analyticDraw = 0;
    for (let k = 0; k < matrix.length; k++) analyticDraw += matrix[k]![k]!;
    expect(draws / runs).toBeCloseTo(analyticDraw, 2);

    for (const key of ['0-0', '1-1', '2-1', '1-0']) {
      const [h, a] = key.split('-').map(Number);
      expect((counts.get(key) ?? 0) / runs).toBeCloseTo(matrix[h!]![a!]!, 2);
    }
  });

  it('scores a dataset as the sum of its per-match log probabilities', () => {
    const matches = [
      { muHome: 1.5, muAway: 1.2, goalsHome: 1, goalsAway: 1 },
      { muHome: 2.1, muAway: 0.9, goalsHome: 3, goalsAway: 0 },
    ];
    const shape: ShapeParameters = { sigma: 0.25, tempoShare: 0.5, rho: 0.05 };
    const grid = buildShockGrid(shape);

    const expected =
      matchLogProbability(matches[0]!, shape, grid) + matchLogProbability(matches[1]!, shape, grid);

    expect(mixedLogLikelihood(matches, shape)).toBeCloseTo(expected, 12);
  });
});

describe('nelderMead', () => {
  it('finds the minimum of a quadratic bowl', () => {
    const result = nelderMead((p) => (p[0]! - 3) ** 2 + (p[1]! + 1) ** 2, [0, 0]);
    expect(result.converged).toBe(true);
    expect(result.point[0]!).toBeCloseTo(3, 4);
    expect(result.point[1]!).toBeCloseTo(-1, 4);
  });

  it('handles an empty parameter vector', () => {
    const result = nelderMead(() => 7, []);
    expect(result.value).toBe(7);
    expect(result.converged).toBe(true);
  });
});

describe('fitShapeParameters', () => {
  it('recovers shape parameters from data generated with them', () => {
    const rng = goodRng(4);
    const truth: ShapeParameters = { sigma: 0.35, tempoShare: 0.6, rho: 0 };

    const matches = [];
    for (let i = 0; i < 6000; i++) {
      const outcome = simulateMatchOutcome(team(1, 1800), team(2, 1800), {
        upsetVariance: truth.sigma,
        tempoShare: truth.tempoShare,
        rng,
      });
      matches.push({
        muHome: DEFAULT_BASELINE_HOME,
        muAway: DEFAULT_BASELINE_AWAY,
        goalsHome: outcome.goalsHome,
        goalsAway: outcome.goalsAway,
      });
    }

    const fit = fitShapeParameters(matches, { fitRho: false, nodeCount: 12 });

    expect(fit.shape.sigma).toBeCloseTo(truth.sigma, 1);
    expect(fit.shape.tempoShare).toBeCloseTo(truth.tempoShare, 1);
    // The likelihood must at least beat the no-shock model on data that really has shocks.
    expect(fit.logLikelihood).toBeGreaterThan(
      mixedLogLikelihood(matches, INDEPENDENT_POISSON),
    );
  }, 30_000);

  it('pins the parameters it is told not to fit', () => {
    const matches = [
      { muHome: 1.5, muAway: 1.2, goalsHome: 1, goalsAway: 1 },
      { muHome: 1.5, muAway: 1.2, goalsHome: 0, goalsAway: 2 },
    ];

    const noShocks = fitShapeParameters(matches, { fitShocks: false, fitRho: true });
    expect(noShocks.shape.sigma).toBe(0);
    expect(noShocks.freeParameters).toBe(1);

    const noRho = fitShapeParameters(matches, { fitShocks: true, fitRho: false });
    expect(noRho.shape.rho).toBe(0);
    expect(noRho.freeParameters).toBe(2);
  });
});
