import { describe, expect, it } from 'vitest';
import {
  anchoredWalkForward,
  buildAnchoredRows,
  pairedComparison,
  type AnchoredWalkForwardResult,
} from '../src/fitting/eloDriftFit.js';
import type { EloHistory, HistoricalDataset, HistoricalMatch } from '../src/fitting/historicalData.js';

/** Two clubs, one season, ratings that move mid-season so a frozen anchor can go stale. */
function dataset(): HistoricalDataset {
  const matches: HistoricalMatch[] = [
    { season: 2024, matchday: 1, date: '2024-08-17', homeClub: 'A', awayClub: 'B', goalsHome: 3, goalsAway: 0 },
    { season: 2024, matchday: 2, date: '2024-08-24', homeClub: 'B', awayClub: 'A', goalsHome: 1, goalsAway: 1 },
  ];

  const eloHistory: EloHistory = new Map([
    [
      'A',
      [
        { from: '2024-01-01', to: '2024-08-20', elo: 1800 },
        { from: '2024-08-21', to: '2024-12-31', elo: 1850 },
      ],
    ],
    [
      'B',
      [
        { from: '2024-01-01', to: '2024-08-20', elo: 1600 },
        { from: '2024-08-21', to: '2024-12-31', elo: 1550 },
      ],
    ],
  ]);

  return { matches, eloHistory };
}

describe('buildAnchoredRows', () => {
  it('holds every club at its season-opening rating when drift is off', () => {
    const rows = buildAnchoredRows(dataset(), { driftWeight: 0 });
    // Both matchdays see the same 200-point gap, despite clubelo moving on 2024-08-21.
    expect(rows[0]!.eloDiff).toBeCloseTo(200 / 400, 12);
    expect(rows[1]!.eloDiff).toBeCloseTo(-200 / 400, 12);
  });

  it('tracks clubelo on the match date when the anchor is not frozen', () => {
    const rows = buildAnchoredRows(dataset(), { freezeAnchor: false, driftWeight: 0 });
    expect(rows[0]!.eloDiff).toBeCloseTo(200 / 400, 12);
    // Matchday 2 is after the ratings move: B 1550 at home, A 1850 away.
    expect(rows[1]!.eloDiff).toBeCloseTo(-300 / 400, 12);
  });

  it('is identical to the frozen anchor when K is zero', () => {
    const withK = buildAnchoredRows(dataset(), { eloK: 0 });
    const without = buildAnchoredRows(dataset(), { driftWeight: 0 });
    expect(withK.map((r) => r.eloDiff)).toEqual(without.map((r) => r.eloDiff));
  });

  it('moves the second matchday once drift is on', () => {
    const rows = buildAnchoredRows(dataset(), { eloK: 20 });
    // A won matchday 1, so by matchday 2 it has drifted above its anchor and B below.
    expect(rows[1]!.eloDiff).toBeLessThan(-200 / 400);
  });

  it('leaves drift out of the design column, since it is folded into the rating', () => {
    const rows = buildAnchoredRows(dataset(), { eloK: 20 });
    expect(rows.every((row) => row.driftDiff === 0)).toBe(true);
  });

  it('re-anchors each season rather than carrying drift across the summer', () => {
    const base = dataset();
    const twoSeasons: HistoricalDataset = {
      eloHistory: base.eloHistory,
      matches: [
        ...base.matches,
        { season: 2025, matchday: 1, date: '2025-08-16', homeClub: 'A', awayClub: 'B', goalsHome: 0, goalsAway: 0 },
      ],
    };
    const rows = buildAnchoredRows(twoSeasons, { eloK: 20 });
    const opener2025 = rows.find((row) => row.season === 2025)!;
    // 2025 opens on clubelo's rating with drift reset, not on where 2024 left off.
    expect(opener2025.eloDiff).toBeCloseTo((1850 - 1550) / 400, 12);
  });
});

describe('anchoredWalkForward', () => {
  it('reports no origins when there is never enough training data', () => {
    const rows = buildAnchoredRows(dataset(), { eloK: 20 });
    const result = anchoredWalkForward(rows, 380);
    expect(result.evaluated).toBe(0);
    expect(result.perOrigin).toEqual([]);
    expect(Number.isNaN(result.logLikelihood)).toBe(true);
  });
});

describe('pairedComparison', () => {
  const of = (perOrigin: number[]): AnchoredWalkForwardResult => ({
    evaluated: perOrigin.length,
    logLikelihood: perOrigin.reduce((s, v) => s + v, 0) / perOrigin.length,
    perOrigin,
  });

  it('reports a zero difference and no signal against itself', () => {
    const a = of([-3.0, -2.5, -3.4, -2.9]);
    const p = pairedComparison(a, a);
    expect(p.meanDifference).toBe(0);
    expect(p.standardError).toBe(0);
  });

  it('cancels the shared origin-to-origin swing that dwarfs the effect', () => {
    // Wildly different origins, but `a` beats `b` by exactly 0.01 every time.
    const b = of([-3.5, -2.1, -3.9, -2.6, -3.1]);
    const a = of(b.perOrigin.map((v) => v + 0.01));
    const p = pairedComparison(a, b);
    expect(p.meanDifference).toBeCloseTo(0.01, 12);
    expect(p.standardError).toBeCloseTo(0, 12);
    expect(p.origins).toBe(5);
  });

  it('returns a small t when the difference is swamped by its own scatter', () => {
    const b = of([-3.0, -3.0, -3.0, -3.0]);
    const a = of([-2.5, -3.6, -2.6, -3.4]);
    const p = pairedComparison(a, b);
    expect(Math.abs(p.tStatistic)).toBeLessThan(2);
  });
});
