import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEASON_ELO_K,
  matchEloDelta,
  movMultiplier,
  type MovScheme,
} from '../src/engine/seasonElo.js';

describe('movMultiplier', () => {
  it('leaves one-goal and drawn results unscaled under every scheme', () => {
    for (const scheme of ['none', 'linear', 'log'] as MovScheme[]) {
      expect(movMultiplier(scheme, 0, 0)).toBe(1);
      expect(movMultiplier(scheme, 1, 100)).toBe(1);
      expect(movMultiplier(scheme, -1, 100)).toBe(1);
    }
  });

  it('ignores the margin entirely under `none`', () => {
    expect(movMultiplier('none', 5, 300)).toBe(1);
  });

  it('follows the World Football ladder under `linear`', () => {
    expect(movMultiplier('linear', 2, 0)).toBe(1.5);
    expect(movMultiplier('linear', 3, 0)).toBeCloseTo(14 / 8, 10);
    expect(movMultiplier('linear', 5, 0)).toBeCloseTo(2, 10);
  });

  it('is symmetric in the sign of the margin', () => {
    for (const scheme of ['linear', 'log'] as MovScheme[]) {
      expect(movMultiplier(scheme, 3, 120)).toBeCloseTo(movMultiplier(scheme, -3, 120), 12);
    }
  });

  it('grows with the margin under `log`', () => {
    const edge = 0;
    const two = movMultiplier('log', 2, edge);
    const four = movMultiplier('log', 4, edge);
    expect(four).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(1);
  });

  it('damps a favourite thrashing an underdog, but not the reverse', () => {
    // Same four-goal margin: once won by the stronger side, once by the weaker.
    const favouriteRout = movMultiplier('log', 4, 400);
    const upsetRout = movMultiplier('log', 4, -400);
    expect(favouriteRout).toBeLessThan(upsetRout);
  });
});

describe('matchEloDelta margin scaling', () => {
  const home = 1800;
  const away = 1600;

  it('defaults to the unscaled result, so existing behaviour is unchanged', () => {
    const [a] = matchEloDelta(home, away, 4, 0);
    const [b] = matchEloDelta(home, away, 1, 0);
    expect(a).toBeCloseTo(b, 12);
  });

  it('separates a rout from a narrow win once a scheme is set', () => {
    const [narrow] = matchEloDelta(home, away, 1, 0, DEFAULT_SEASON_ELO_K, { movScheme: 'log' });
    const [rout] = matchEloDelta(home, away, 4, 0, DEFAULT_SEASON_ELO_K, { movScheme: 'log' });
    expect(rout).toBeGreaterThan(narrow);
  });

  it('stays zero-sum whatever the scheme', () => {
    for (const movScheme of ['none', 'linear', 'log'] as MovScheme[]) {
      const [h, a] = matchEloDelta(home, away, 3, 0, DEFAULT_SEASON_ELO_K, { movScheme });
      expect(h + a).toBeCloseTo(0, 12);
    }
  });

  it('does not scale draws, which have no winner to damp against', () => {
    for (const movScheme of ['none', 'linear', 'log'] as MovScheme[]) {
      const [h] = matchEloDelta(home, away, 2, 2, DEFAULT_SEASON_ELO_K, { movScheme });
      const [plain] = matchEloDelta(home, away, 2, 2);
      expect(h).toBeCloseTo(plain, 12);
    }
  });
});
