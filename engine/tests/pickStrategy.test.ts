import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PICK_STRATEGY,
  parsePickStrategy,
  rankScorelineCandidates,
  type OutcomeCounts,
  type ScorelineCount,
} from '../src/engine/pickStrategy.js';

function scorelines(entries: Array<[number, number, number]>): ScorelineCount[] {
  return entries.map(([goalsHome, goalsAway, n]) => ({ goalsHome, goalsAway, n }));
}

/**
 * A clear home favourite whose win mass is spread across several scorelines, so the single most
 * likely scoreline is the draw. 10,000 runs.
 */
const clearFavourite = {
  outcomes: { homeWin: 5200, draw: 2400, awayWin: 2400 } satisfies OutcomeCounts,
  scorelines: scorelines([
    [1, 0, 880],
    [2, 0, 760],
    [2, 1, 720],
    [1, 1, 900],
    [0, 0, 810],
    [0, 1, 520],
    [1, 2, 430],
  ]),
};

/** Three-way toss-up where the draw mass is concentrated on 1–1. 10,000 runs. */
const tossUp = {
  outcomes: { homeWin: 3610, draw: 3090, awayWin: 3300 } satisfies OutcomeCounts,
  scorelines: scorelines([
    [1, 0, 720],
    [2, 1, 690],
    [1, 1, 1105],
    [0, 0, 640],
    [0, 1, 655],
    [1, 2, 640],
  ]),
};

describe('parsePickStrategy', () => {
  it('accepts a camelCase strategy name in any casing', () => {
    expect(parsePickStrategy('calibrated')).toBe('calibrated');
    expect(parsePickStrategy(' CALIBRATED ')).toBe('calibrated');
  });

  it('accepts the pre-rename names so stored rows still resolve', () => {
    expect(parsePickStrategy('sample')).toBe('random');
  });

  it('falls back to the default for anything unrecognised', () => {
    expect(parsePickStrategy('expected')).toBe(DEFAULT_PICK_STRATEGY);
  });

  // Every withdrawn strategy lands on the default rather than resolving to something that no
  // longer exists — the per-fixture pair and their pre-rename names along with maxPoints.
  it('falls back to the default for every withdrawn strategy', () => {
    for (const name of [
      'maxPoints',
      'expectedPoints',
      'likeliestScore',
      'likeliestResult',
      'scoreline',
      'outcome',
    ]) {
      expect(parsePickStrategy(name)).toBe(DEFAULT_PICK_STRATEGY);
    }
  });
});

describe('rankScorelineCandidates', () => {
  it('returns one candidate per outcome, most frequent first', () => {
    const ranked = rankScorelineCandidates(tossUp.scorelines);

    expect(ranked.map((c) => [c.goalsHome, c.goalsAway])).toEqual([
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    expect(ranked.map((c) => c.outcome)).toEqual(['draw', 'homeWin', 'awayWin']);
    // 1–1 is the modal draw at 1105 runs, ahead of 1–0's 720 and 0–1's 655.
    expect(ranked.map((c) => c.n)).toEqual([1105, 720, 655]);
  });

  it('picks each outcome\'s modal scoreline, not its first', () => {
    const ranked = rankScorelineCandidates(clearFavourite.scorelines);
    const home = ranked.find((c) => c.outcome === 'homeWin')!;

    // Home win mass is spread over 1–0, 2–0 and 2–1; the most frequent of those wins.
    expect([home.goalsHome, home.goalsAway]).toEqual([1, 0]);
    expect(home.n).toBe(880);
  });

  it('leads with the single most frequent scoreline in the batch', () => {
    for (const fixture of [clearFavourite, tossUp]) {
      const top = rankScorelineCandidates(fixture.scorelines)[0]!;
      const mostFrequent = [...fixture.scorelines].sort((a, b) => b.n - a.n)[0]!;
      expect({ goalsHome: top.goalsHome, goalsAway: top.goalsAway }).toEqual({
        goalsHome: mostFrequent.goalsHome,
        goalsAway: mostFrequent.goalsAway,
      });
    }
  });

  it('drops outcomes no run produced', () => {
    const ranked = rankScorelineCandidates(scorelines([[2, 0, 400], [1, 0, 600]]));

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.outcome).toBe('homeWin');
  });

  it('ranks nothing when the batch produced no scorelines', () => {
    expect(rankScorelineCandidates([])).toEqual([]);
  });
});
