import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASELINE_AWAY,
  DEFAULT_BASELINE_HOME,
  DEFAULT_ELO_GOAL_SCALE,
  DEFAULT_MATCH_TOTAL,
  MIN_LAMBDA,
  computeMatchLambdas,
  samplePoisson,
  simulateMatchOutcome,
} from '../src/engine/matchSimulator.js';
import type { Team } from '../src/engine/types.js';
import { testRng } from './testRng.js';

function team(id: number, elo: number): Team {
  return {
    id,
    name: `Team ${id}`,
    shortName: `T${id}`,
    crest: null,
    elo,
  };
}

describe('computeMatchLambdas', () => {
  it('gives the home side the advantage between evenly matched teams', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(team(1, 1500), team(2, 1500));
    expect(lambdaHome).toBeGreaterThan(lambdaAway);
    expect(lambdaHome + lambdaAway).toBeCloseTo(DEFAULT_MATCH_TOTAL, 10);
  });

  it('uses the four-season home/away baselines in an even match', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(team(1, 1500), team(2, 1500));
    expect(lambdaHome).toBeCloseTo(DEFAULT_BASELINE_HOME, 10);
    expect(lambdaAway).toBeCloseTo(DEFAULT_BASELINE_AWAY, 10);
  });

  it('keeps the match total fixed when Elo gaps change', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(team(1, 1900), team(2, 1500));
    expect(lambdaHome).toBeGreaterThan(lambdaAway);
    expect(lambdaHome + lambdaAway).toBeCloseTo(DEFAULT_MATCH_TOTAL, 10);
  });

  it('scales the gap with Elo difference', () => {
    const mild = computeMatchLambdas(team(1, 1700), team(2, 1500));
    const large = computeMatchLambdas(team(1, 1900), team(2, 1500));
    expect(large.lambdaHome - large.lambdaAway).toBeGreaterThan(mild.lambdaHome - mild.lambdaAway);
  });

  it('honours equal home and away baselines', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(
      team(1, 1500),
      team(2, 1500),
      1.5,
      1.5,
    );
    expect(lambdaHome).toBeCloseTo(lambdaAway, 10);
  });

  it('clamps extreme mismatches at MIN_LAMBDA', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(
      team(1, 2500),
      team(2, 1000),
      DEFAULT_BASELINE_HOME,
      DEFAULT_BASELINE_AWAY,
      DEFAULT_ELO_GOAL_SCALE,
    );
    expect(lambdaAway).toBe(MIN_LAMBDA);
    expect(lambdaHome).toBeGreaterThan(DEFAULT_BASELINE_HOME);
  });
});

describe('samplePoisson', () => {
  it('returns 0 for a non-positive lambda', () => {
    expect(samplePoisson(0, testRng())).toBe(0);
    expect(samplePoisson(-1, testRng())).toBe(0);
  });

  it('averages close to lambda over many draws', () => {
    const rng = testRng(7);
    const draws = Array.from({ length: 20_000 }, () => samplePoisson(1.5, rng));
    const mean = draws.reduce((sum, n) => sum + n, 0) / draws.length;
    expect(mean).toBeGreaterThan(1.42);
    expect(mean).toBeLessThan(1.58);
  });
});

describe('simulateMatchOutcome', () => {
  it('is deterministic for a given seed', () => {
    const a = simulateMatchOutcome(team(1, 1800), team(2, 1600), { rng: testRng(42) });
    const b = simulateMatchOutcome(team(1, 1800), team(2, 1600), { rng: testRng(42) });
    expect(a).toEqual(b);
  });

  it('never produces negative goals', () => {
    const rng = testRng(3);
    for (let i = 0; i < 500; i++) {
      const outcome = simulateMatchOutcome(team(1, 1900), team(2, 1500), { rng });
      expect(outcome.goalsHome).toBeGreaterThanOrEqual(0);
      expect(outcome.goalsAway).toBeGreaterThanOrEqual(0);
    }
  });
});
