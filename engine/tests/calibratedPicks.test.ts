import { describe, expect, it } from 'vitest';
import {
  buildCalibratedPicks,
  drawTargetsFromSeason,
  expectedSeasonPoints,
  plausiblePicksFor,
  type CalibratedFixture,
  type SampledSeason,
} from '../src/engine/calibratedPicks.js';
import { outcomeFromScoreline, type MatchOutcome } from '../src/engine/pickStrategy.js';

const RUNS = 10_000;

/**
 * A fixture whose outcome split is `[home, draw, away]`. Scoreline mass is spread the way the
 * Poisson model spreads it — draws piled onto 1–1 and 0–0, wins spread over three scorelines —
 * because that concentration is exactly what breaks the per-fixture strategies.
 */
function fixture(
  matchNumber: number,
  teamHomeId: number,
  teamAwayId: number,
  [home, draw, away]: [number, number, number],
): CalibratedFixture {
  const counts = {
    homeWin: Math.round(home * RUNS),
    draw: Math.round(draw * RUNS),
    awayWin: Math.round(away * RUNS),
  };
  const split = (total: number, shares: number[]) => shares.map((share) => Math.round(total * share));
  const [h1, h2, h3] = split(counts.homeWin, [0.45, 0.3, 0.25]);
  const [d1, d2] = split(counts.draw, [0.6, 0.4]);
  const [a1, a2, a3] = split(counts.awayWin, [0.45, 0.3, 0.25]);

  return {
    matchNumber,
    teamHomeId,
    teamAwayId,
    outcomeCounts: counts,
    scorelines: [
      { goalsHome: 1, goalsAway: 0, n: h1! },
      { goalsHome: 2, goalsAway: 0, n: h2! },
      { goalsHome: 2, goalsAway: 1, n: h3! },
      { goalsHome: 1, goalsAway: 1, n: d1! },
      { goalsHome: 0, goalsAway: 0, n: d2! },
      { goalsHome: 0, goalsAway: 1, n: a1! },
      { goalsHome: 0, goalsAway: 2, n: a2! },
      { goalsHome: 1, goalsAway: 2, n: a3! },
    ].filter((scoreline) => scoreline.n > 0),
  };
}

/** Double round robin over `teamCount` teams, with strength driving each fixture's split. */
function league(teamCount: number): CalibratedFixture[] {
  const fixtures: CalibratedFixture[] = [];
  let matchNumber = 1;

  for (let home = 1; home <= teamCount; home++) {
    for (let away = 1; away <= teamCount; away++) {
      if (home === away) continue;
      // Strength runs 1 (best) to teamCount (worst); the gap tilts the home/away split.
      const edge = (away - home) / teamCount;
      const drawShare = 0.26 - 0.12 * Math.abs(edge);
      const homeShare = (1 - drawShare) * (0.55 + 0.4 * edge);
      fixtures.push(
        fixture(matchNumber++, home, away, [homeShare, drawShare, 1 - drawShare - homeShare]),
      );
    }
  }
  return fixtures;
}

function outcomeCounts(
  fixtures: CalibratedFixture[],
  picks: Map<number, { goalsHome: number; goalsAway: number }>,
): Record<MatchOutcome, number> {
  const counts: Record<MatchOutcome, number> = { homeWin: 0, draw: 0, awayWin: 0 };
  for (const f of fixtures) {
    const pick = picks.get(f.matchNumber);
    if (pick) counts[outcomeFromScoreline(pick)] += 1;
  }
  return counts;
}

function expectedCounts(fixtures: CalibratedFixture[]): Record<MatchOutcome, number> {
  const totals: Record<MatchOutcome, number> = { homeWin: 0, draw: 0, awayWin: 0 };
  for (const f of fixtures) {
    const total = f.outcomeCounts.homeWin + f.outcomeCounts.draw + f.outcomeCounts.awayWin;
    totals.homeWin += f.outcomeCounts.homeWin / total;
    totals.draw += f.outcomeCounts.draw / total;
    totals.awayWin += f.outcomeCounts.awayWin / total;
  }
  return totals;
}

function drawsByTeam(
  fixtures: CalibratedFixture[],
  picks: Map<number, { goalsHome: number; goalsAway: number }>,
): Map<number, number> {
  const draws = new Map<number, number>();
  for (const f of fixtures) {
    const pick = picks.get(f.matchNumber);
    if (!pick || outcomeFromScoreline(pick) !== 'draw') continue;
    draws.set(f.teamHomeId, (draws.get(f.teamHomeId) ?? 0) + 1);
    draws.set(f.teamAwayId, (draws.get(f.teamAwayId) ?? 0) + 1);
  }
  return draws;
}

describe('buildCalibratedPicks', () => {
  const fixtures = league(20);

  it('matches the league outcome split the simulation expects', () => {
    const picks = buildCalibratedPicks(fixtures);
    const realised = outcomeCounts(fixtures, picks);
    const expected = expectedCounts(fixtures);

    expect(picks.size).toBe(380);
    // Within one fixture of the expectation on every outcome — the rounding slack, no more.
    expect(Math.abs(realised.homeWin - expected.homeWin)).toBeLessThanOrEqual(1);
    expect(Math.abs(realised.draw - expected.draw)).toBeLessThanOrEqual(1);
    expect(Math.abs(realised.awayWin - expected.awayWin)).toBeLessThanOrEqual(1);
  });

  it('spreads draws across teams instead of piling them on even fixtures', () => {
    const picks = buildCalibratedPicks(fixtures);
    const draws = drawsByTeam(fixtures, picks);

    const perTeam = [...draws.values()];
    expect(perTeam).toHaveLength(20);
    // A global quota alone leaves the strongest and weakest teams on nearly none; the per-team
    // targets are what keep every side inside a plausible band.
    expect(Math.min(...perTeam)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...perTeam)).toBeLessThanOrEqual(14);
  });

  it('gives draws where picking each fixture on its own would give none', () => {
    // The withdrawn per-fixture rules took each fixture's likeliest outcome. A draw is never
    // that, which is the failure the season-wide solve exists to avoid — so reproduce the rule
    // here rather than keep a strategy around to demonstrate it.
    const likeliestOutcomeIsDraw = fixtures.filter((f) => {
      const { homeWin, draw, awayWin } = f.outcomeCounts;
      return draw > homeWin && draw > awayWin;
    });

    expect(likeliestOutcomeIsDraw).toHaveLength(0);
    expect(outcomeCounts(fixtures, buildCalibratedPicks(fixtures)).draw).toBeGreaterThan(70);
  });

  it('is deterministic', () => {
    const first = buildCalibratedPicks(fixtures);
    const second = buildCalibratedPicks([...fixtures].reverse());

    expect(second.size).toBe(first.size);
    for (const [matchNumber, pick] of first) {
      expect(second.get(matchNumber)).toEqual(pick);
    }
  });

  it('pins a fixture whose distribution has collapsed onto one scoreline', () => {
    const locked: CalibratedFixture = {
      matchNumber: 1,
      teamHomeId: 1,
      teamAwayId: 2,
      outcomeCounts: { homeWin: RUNS, draw: 0, awayWin: 0 },
      scorelines: [{ goalsHome: 6, goalsAway: 0, n: RUNS }],
    };
    const picks = buildCalibratedPicks([locked, ...league(6).slice(1)]);

    expect(picks.get(1)).toEqual({ goalsHome: 6, goalsAway: 0 });
  });

  it('returns nothing for an empty fixture list', () => {
    expect(buildCalibratedPicks([]).size).toBe(0);
  });
});

/** The batch shape `plausiblePicksFor` reads, derived from the same fixtures. */
function distributionsOf(fixtures: CalibratedFixture[]) {
  return new Map(
    fixtures.map((f) => [f.matchNumber, { outcomes: f.outcomeCounts, scorelines: f.scorelines }]),
  );
}

/**
 * A simulated season over `fixtures`, each match drawn against its own outcome split.
 *
 * Seeded and deterministic, so the reservoir is the same on every run. Sampling each fixture at
 * its own draw probability rather than a flat rate is what makes the reservoir scatter around
 * the batch's expectation the way a real one does — including the draw-light seasons that a
 * points-only ranking would reach for.
 */
function sampledSeason(fixtures: CalibratedFixture[], seed: number): SampledSeason {
  let state = seed * 2_654_435_761 + 1;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return new Map(
    fixtures.map((f) => {
      const counts = f.outcomeCounts;
      const drawShare = counts.draw / (counts.homeWin + counts.draw + counts.awayWin);
      return next() < drawShare
        ? [f.matchNumber, { goalsHome: 1, goalsAway: 1 }]
        : [f.matchNumber, { goalsHome: 1, goalsAway: 0 }];
    }),
  );
}

describe('plausiblePicksFor', () => {
  const fixtures = league(20);
  const distributions = distributionsOf(fixtures);
  const reservoir = Array.from({ length: 12 }, (_, i) => sampledSeason(fixtures, i + 1));

  it("counts every club's draws in a sampled season, zeros included", () => {
    const season: SampledSeason = new Map([
      [fixtures[0]!.matchNumber, { goalsHome: 1, goalsAway: 1 }],
      [fixtures[1]!.matchNumber, { goalsHome: 2, goalsAway: 0 }],
    ]);
    const targets = drawTargetsFromSeason(fixtures, season);

    expect(targets.size).toBe(20);
    expect(targets.get(fixtures[0]!.teamHomeId)).toBe(1);
    expect(targets.get(fixtures[0]!.teamAwayId)).toBe(1);
    // Every club appears, so a side that drew nothing is a 0 rather than a missing key.
    expect([...targets.values()].filter((v) => v === 0).length).toBeGreaterThan(0);
  });

  it('lands on one sampled season, not on the average of them', () => {
    const picks = plausiblePicksFor(fixtures, distributions, reservoir);
    const realised = drawsByTeam(fixtures, picks);

    const deviation = (season: SampledSeason) => {
      const targets = drawTargetsFromSeason(fixtures, season);
      const diffs = [...targets].map(([teamId, target]) =>
        Math.abs((realised.get(teamId) ?? 0) - target),
      );
      return {
        mean: diffs.reduce((a, b) => a + b, 0) / diffs.length,
        worst: Math.max(...diffs),
      };
    };
    const deviations = reservoir.map(deviation).sort((a, b) => a.mean - b.mean);

    // The biases solve a dual over integer counts, so the targets are aimed at rather than
    // guaranteed — but the season it settles on comes out within a single draw of every club.
    expect(deviations[0]!.worst).toBeLessThanOrEqual(1);
    expect(deviations[0]!.mean).toBeLessThan(0.5);
    // And it is unmistakably that one season rather than a blend: the next-closest candidate
    // sits several times further from the table that came out.
    expect(deviations[1]!.mean).toBeGreaterThan(deviations[0]!.mean * 3);
  });


  it('spreads clubs wider than the mean-targeted solve', () => {
    const spread = (picks: Map<number, { goalsHome: number; goalsAway: number }>) => {
      const perTeam = [...drawsByTeam(fixtures, picks).values()];
      const mean = perTeam.reduce((a, b) => a + b, 0) / perTeam.length;
      return Math.sqrt(perTeam.reduce((a, b) => a + (b - mean) ** 2, 0) / perTeam.length);
    };

    const calibrated = spread(buildCalibratedPicks(fixtures));
    const plausible = spread(plausiblePicksFor(fixtures, distributions, reservoir));
    expect(plausible).toBeGreaterThan(calibrated * 1.5);
  });

  /** Draws the batch expects across the whole fixture list, and each sample's own total. */
  const expectedDraws = fixtures.reduce((sum, f) => {
    const counts = f.outcomeCounts;
    return sum + counts.draw / (counts.homeWin + counts.draw + counts.awayWin);
  }, 0);
  const totalOf = (season: SampledSeason) =>
    [...drawTargetsFromSeason(fixtures, season).values()].reduce((a, b) => a + b, 0) / 2;

  it('holds the league draw total the batch expects', () => {
    const picks = plausiblePicksFor(fixtures, distributions, reservoir);
    const realised = [...picks.values()].filter((p) => p.goalsHome === p.goalsAway).length;

    // The reservoir has draw-light seasons in it, and they are the ones worth the most under
    // any payoff — a draw is rarely a fixture's modal outcome. Ranking on points alone would
    // take one of those and land the league well under its own expectation.
    const cheapest = Math.min(...reservoir.map(totalOf));
    expect(cheapest).toBeLessThan(expectedDraws - 2);
    expect(Math.abs(realised - expectedDraws)).toBeLessThanOrEqual(2);
  });

  it('breaks a level tie by sample order', () => {
    // Two seasons with the same league total — so neither can win on level — but opposite
    // draw profiles, drawn from opposite ends of the fixture list.
    const drawCount = Math.round(expectedDraws);
    const seasonOf = (drawn: CalibratedFixture[]): SampledSeason => {
      const ids = new Set(drawn.map((f) => f.matchNumber));
      return new Map(
        fixtures.map((f) =>
          ids.has(f.matchNumber)
            ? [f.matchNumber, { goalsHome: 1, goalsAway: 1 }]
            : [f.matchNumber, { goalsHome: 1, goalsAway: 0 }],
        ),
      );
    };
    const first = seasonOf(fixtures.slice(0, drawCount));
    const second = seasonOf(fixtures.slice(-drawCount));
    expect(totalOf(first)).toBe(totalOf(second));

    const deviationFrom = (season: SampledSeason, picks: ReturnType<typeof plausiblePicksFor>) => {
      const realised = drawsByTeam(fixtures, picks);
      const targets = drawTargetsFromSeason(fixtures, season);
      const diffs = [...targets].map(([teamId, target]) =>
        Math.abs((realised.get(teamId) ?? 0) - target),
      );
      return diffs.reduce((a, b) => a + b, 0) / diffs.length;
    };

    const forwards = plausiblePicksFor(fixtures, distributions, [first, second]);
    expect(deviationFrom(first, forwards)).toBeLessThan(deviationFrom(second, forwards));

    // Reverse the reservoir and the tie goes the other way — order is the whole rule.
    const backwards = plausiblePicksFor(fixtures, distributions, [second, first]);
    expect(deviationFrom(second, backwards)).toBeLessThan(deviationFrom(first, backwards));
  });

  it('falls back to the mean-targeted solve with no reservoir to draw on', () => {
    const picks = plausiblePicksFor(fixtures, distributions, []);
    const calibrated = buildCalibratedPicks(fixtures);

    expect(picks.size).toBe(calibrated.size);
    for (const [matchNumber, pick] of calibrated) {
      expect(picks.get(matchNumber)).toEqual(pick);
    }
  });

  it('is deterministic', () => {
    const first = plausiblePicksFor(fixtures, distributions, reservoir);
    const second = plausiblePicksFor(fixtures, distributions, reservoir);

    for (const [matchNumber, pick] of first) {
      expect(second.get(matchNumber)).toEqual(pick);
    }
  });
});
