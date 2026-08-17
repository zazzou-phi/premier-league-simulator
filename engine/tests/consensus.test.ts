import { describe, expect, it } from 'vitest';
import {
  chooseConsensus,
  chooseExpectedPointsScoreline,
  parseConsensusMode,
  rankExpectedPoints,
  type OutcomeCounts,
  type ScorelineCount,
} from '../src/engine/consensus.js';

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

const elo = { homeElo: 1800, awayElo: 1750 };

describe('parseConsensusMode', () => {
  it('accepts the camelCase expectedPoints mode', () => {
    expect(parseConsensusMode('expectedPoints')).toBe('expectedPoints');
    expect(parseConsensusMode(' EXPECTEDPOINTS ')).toBe('expectedPoints');
  });

  it('falls back to the default for anything unrecognised', () => {
    expect(parseConsensusMode('expected')).toBe('outcome');
  });
});

describe('chooseExpectedPointsScoreline', () => {
  it('backs the favourite when the outcome margin outweighs scoreline concentration', () => {
    const pick = chooseExpectedPointsScoreline(
      clearFavourite.outcomes,
      clearFavourite.scorelines,
      elo.homeElo,
      elo.awayElo,
      { exactScore: 3, correctResult: 1 },
    );
    // 1–0 scores 5200 + 2·880 = 6960 against 1–1 at 2400 + 2·900 = 4200.
    expect(pick).toEqual({ goalsHome: 1, goalsAway: 0 });
  });

  it('takes the concentrated draw when the outcomes are close', () => {
    const pick = chooseExpectedPointsScoreline(
      tossUp.outcomes,
      tossUp.scorelines,
      elo.homeElo,
      elo.awayElo,
      { exactScore: 3, correctResult: 1 },
    );
    // 1–1 scores 3090 + 2·1105 = 5300 against 1–0 at 3610 + 2·720 = 5050.
    expect(pick).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('shifts with the payoff: a bigger exact-score bonus buys the concentrated scoreline', () => {
    const pickAt = (exactScore: number) =>
      chooseExpectedPointsScoreline(
        tossUp.outcomes,
        tossUp.scorelines,
        elo.homeElo,
        elo.awayElo,
        { exactScore, correctResult: 1 },
      );

    expect(pickAt(1)).toEqual({ goalsHome: 1, goalsAway: 0 });
    expect(pickAt(3)).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('collapses onto outcome mode when an exact score pays no premium', () => {
    for (const fixture of [clearFavourite, tossUp]) {
      const expectedPoints = chooseExpectedPointsScoreline(
        fixture.outcomes,
        fixture.scorelines,
        elo.homeElo,
        elo.awayElo,
        { exactScore: 1, correctResult: 1 },
      );
      const outcome = chooseConsensus({
        mode: 'outcome',
        outcomeCounts: fixture.outcomes,
        scorelines: fixture.scorelines,
        ...elo,
      });
      expect(expectedPoints).toEqual(outcome);
    }
  });

  it('disagrees with both existing scoreline-family modes across the two fixtures', () => {
    const pick = (mode: 'scoreline' | 'outcome' | 'expectedPoints', fixture: typeof tossUp) =>
      chooseConsensus({
        mode,
        outcomeCounts: fixture.outcomes,
        scorelines: fixture.scorelines,
        points: { exactScore: 3, correctResult: 1 },
        ...elo,
      });

    // Neither existing mode is right in both rows; expectedPoints tracks whichever is.
    expect(pick('scoreline', clearFavourite)).toEqual({ goalsHome: 1, goalsAway: 1 });
    expect(pick('expectedPoints', clearFavourite)).toEqual({ goalsHome: 1, goalsAway: 0 });

    expect(pick('outcome', tossUp)).toEqual({ goalsHome: 1, goalsAway: 0 });
    expect(pick('expectedPoints', tossUp)).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('can land on the outcome that is neither the favourite nor the modal scoreline', () => {
    const pick = chooseExpectedPointsScoreline(
      { homeWin: 4000, draw: 2800, awayWin: 3200 },
      scorelines([
        [1, 0, 600],
        [1, 1, 1100],
        [0, 1, 1050],
      ]),
      elo.homeElo,
      elo.awayElo,
      { exactScore: 3, correctResult: 1 },
    );
    // 0–1: 3200 + 2·1050 = 5300, ahead of 1–0 at 5200 and 1–1 at 5000.
    expect(pick).toEqual({ goalsHome: 0, goalsAway: 1 });
  });

  it('defaults the payoff when none is supplied', () => {
    const withDefault = chooseExpectedPointsScoreline(
      tossUp.outcomes,
      tossUp.scorelines,
      elo.homeElo,
      elo.awayElo,
    );
    expect(withDefault).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('returns null when the batch produced no scorelines', () => {
    const pick = chooseExpectedPointsScoreline(
      { homeWin: 0, draw: 0, awayWin: 0 },
      [],
      elo.homeElo,
      elo.awayElo,
    );
    expect(pick).toBeNull();
  });

  it('ranks all three candidates with expected points per fixture', () => {
    const ranked = rankExpectedPoints(tossUp.outcomes, tossUp.scorelines, {
      exactScore: 3,
      correctResult: 1,
    });

    expect(ranked.map((c) => [c.goalsHome, c.goalsAway])).toEqual([
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    // 1–1: (1·3090 + 2·1105) / 10000 = 0.530
    expect(ranked[0]!.expectedPoints).toBeCloseTo(0.53, 6);
    expect(ranked[0]!.outcome).toBe('draw');
    expect(ranked[1]!.expectedPoints).toBeCloseTo(0.505, 6);
    expect(ranked[2]!.expectedPoints).toBeCloseTo(0.461, 6);
  });

  it('agrees with the chosen scoreline at the top of the ranking', () => {
    for (const fixture of [clearFavourite, tossUp]) {
      for (const exactScore of [1, 3, 8, 25]) {
        const points = { exactScore, correctResult: 1 };
        const ranked = rankExpectedPoints(fixture.outcomes, fixture.scorelines, points);
        const chosen = chooseExpectedPointsScoreline(
          fixture.outcomes,
          fixture.scorelines,
          elo.homeElo,
          elo.awayElo,
          points,
        );
        expect({ goalsHome: ranked[0]!.goalsHome, goalsAway: ranked[0]!.goalsAway }).toEqual(chosen);
      }
    }
  });

  it('ranks nothing when the batch produced no runs', () => {
    expect(rankExpectedPoints({ homeWin: 0, draw: 0, awayWin: 0 }, [])).toEqual([]);
  });

  it('prefers the draw when two candidates tie exactly', () => {
    const pick = chooseExpectedPointsScoreline(
      { homeWin: 4000, draw: 4000, awayWin: 2000 },
      scorelines([
        [1, 0, 900],
        [1, 1, 900],
        [0, 1, 500],
      ]),
      elo.homeElo,
      elo.awayElo,
      { exactScore: 3, correctResult: 1 },
    );
    expect(pick).toEqual({ goalsHome: 1, goalsAway: 1 });
  });
});
