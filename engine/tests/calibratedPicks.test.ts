import { describe, expect, it } from 'vitest';
import { buildCalibratedPicks, type CalibratedFixture } from '../src/engine/calibratedPicks.js';
import { choosePick, outcomeFromScoreline, type MatchOutcome } from '../src/engine/pickStrategy.js';

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

  it('gives draws where the per-fixture strategies give none at all', () => {
    const likeliestResult = fixtures.filter((f) => {
      const pick = choosePick({
        strategy: 'likeliestResult',
        outcomeCounts: f.outcomeCounts,
        scorelines: f.scorelines,
        homeElo: 1500,
        awayElo: 1500,
      })!;
      return outcomeFromScoreline(pick) === 'draw';
    });

    expect(likeliestResult).toHaveLength(0);
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
