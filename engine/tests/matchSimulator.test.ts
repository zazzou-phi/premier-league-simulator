import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASELINE_AWAY,
  DEFAULT_BASELINE_HOME,
  DEFAULT_EVEN_MATCH_TOTAL,
  DEFAULT_TEMPO_SHARE,
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
    expect(lambdaHome + lambdaAway).toBeCloseTo(DEFAULT_EVEN_MATCH_TOTAL, 10);
  });

  it('uses the fitted home/away baselines in an even match', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(team(1, 1500), team(2, 1500));
    expect(lambdaHome).toBeCloseTo(DEFAULT_BASELINE_HOME, 10);
    expect(lambdaAway).toBeCloseTo(DEFAULT_BASELINE_AWAY, 10);
  });

  it('raises the match total as the mismatch widens', () => {
    // The additive model this replaced held every fixture at the same total. Real fixtures
    // inside a 100-point gap average 2.84 goals against 3.37 beyond 300.
    const even = computeMatchLambdas(team(1, 1700), team(2, 1700));
    const mismatch = computeMatchLambdas(team(1, 1900), team(2, 1500));

    expect(mismatch.lambdaHome + mismatch.lambdaAway).toBeGreaterThan(
      even.lambdaHome + even.lambdaAway,
    );
  });

  it('scales the gap with Elo difference', () => {
    const mild = computeMatchLambdas(team(1, 1700), team(2, 1500));
    const large = computeMatchLambdas(team(1, 1900), team(2, 1500));
    expect(large.lambdaHome - large.lambdaAway).toBeGreaterThan(mild.lambdaHome - mild.lambdaAway);
  });

  it('is symmetric: reversing the fixture reverses the rates', () => {
    const forward = computeMatchLambdas(team(1, 1900), team(2, 1500));
    const reversed = computeMatchLambdas(team(2, 1500), team(1, 1900));

    // Same Elo gap, opposite sign, so each side's multiplier inverts about its baseline.
    expect(forward.lambdaHome / DEFAULT_BASELINE_HOME).toBeCloseTo(
      DEFAULT_BASELINE_HOME / reversed.lambdaHome,
      10,
    );
  });

  it('honours equal home and away baselines', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(team(1, 1500), team(2, 1500), 1.5, 1.5);
    expect(lambdaHome).toBeCloseTo(lambdaAway, 10);
  });

  it('stays strictly positive at extreme mismatches, with no floor needed', () => {
    const { lambdaHome, lambdaAway } = computeMatchLambdas(team(1, 2500), team(2, 1000));

    expect(lambdaAway).toBeGreaterThan(0);
    expect(Number.isFinite(lambdaAway)).toBe(true);
    expect(lambdaAway).toBeLessThan(DEFAULT_BASELINE_AWAY);
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

describe('upset variance split', () => {
  const RUNS = 40_000;

  function sample(upsetVariance: number, tempoShare: number, seed = 11) {
    const rng = testRng(seed);
    let draws = 0;
    let goals = 0;
    for (let i = 0; i < RUNS; i++) {
      const outcome = simulateMatchOutcome(team(1, 1800), team(2, 1800), {
        upsetVariance,
        tempoShare,
        rng,
      });
      if (outcome.goalsHome === outcome.goalsAway) draws++;
      goals += outcome.goalsHome + outcome.goalsAway;
    }
    return { drawRate: draws / RUNS, meanGoals: goals / RUNS };
  }

  it('keeps expected goals on the baseline total whatever the share', () => {
    for (const tempoShare of [0, DEFAULT_TEMPO_SHARE, 1]) {
      expect(sample(0.5, tempoShare).meanGoals).toBeCloseTo(DEFAULT_EVEN_MATCH_TOTAL, 1);
    }
  });

  it('holds the draw rate steady as upset variance rises', () => {
    const calm = sample(0, DEFAULT_TEMPO_SHARE).drawRate;
    const wild = sample(0.5, DEFAULT_TEMPO_SHARE).drawRate;
    expect(Math.abs(wild - calm)).toBeLessThan(0.02);
  });

  it('erodes the draw rate when the shock is purely differential', () => {
    // Documents the behaviour DEFAULT_TEMPO_SHARE exists to correct.
    const calm = sample(0, 0).drawRate;
    const wild = sample(0.5, 0).drawRate;
    expect(wild).toBeLessThan(calm - 0.03);
  });

  it('moves both sides together when the shock is purely shared', () => {
    const rng = testRng(5);
    let sameDirection = 0;
    for (let i = 0; i < 2_000; i++) {
      const { lambdaHome, lambdaAway } = simulateMatchOutcome(team(1, 1800), team(2, 1800), {
        upsetVariance: 0.5,
        tempoShare: 1,
        rng,
      });
      const homeUp = lambdaHome > DEFAULT_BASELINE_HOME;
      const awayUp = lambdaAway > DEFAULT_BASELINE_AWAY;
      if (homeUp === awayUp) sameDirection++;
    }
    expect(sameDirection).toBe(2_000);
  });
});
