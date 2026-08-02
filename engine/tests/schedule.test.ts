import { describe, expect, it } from 'vitest';
import {
  MATCHDAYS,
  TOTAL_MATCHES,
  buildDoubleRoundRobin,
  buildSingleRoundRobin,
  findNextMatchday,
  generateFixtures,
} from '../src/engine/schedule.js';

const teamIds = Array.from({ length: 20 }, (_, i) => i + 1);

describe('buildSingleRoundRobin', () => {
  it('produces 19 rounds of 10 matches', () => {
    const rounds = buildSingleRoundRobin(teamIds);
    expect(rounds).toHaveLength(19);
    for (const round of rounds) expect(round).toHaveLength(10);
  });

  it('has every team playing exactly once per round', () => {
    for (const round of buildSingleRoundRobin(teamIds)) {
      const seen = round.flatMap((p) => [p.homeTeamId, p.awayTeamId]);
      expect(new Set(seen).size).toBe(20);
    }
  });

  it('pairs every team with every other team exactly once', () => {
    const pairs = buildSingleRoundRobin(teamIds)
      .flat()
      .map((p) => [p.homeTeamId, p.awayTeamId].sort((a, b) => a - b).join('-'));
    expect(new Set(pairs).size).toBe(190);
  });

  it('rejects odd team counts', () => {
    expect(() => buildSingleRoundRobin([1, 2, 3])).toThrow(/even team count/);
  });
});

describe('buildDoubleRoundRobin', () => {
  it('produces 38 matchdays totalling 380 matches', () => {
    const rounds = buildDoubleRoundRobin(teamIds);
    expect(rounds).toHaveLength(MATCHDAYS);
    expect(rounds.flat()).toHaveLength(TOTAL_MATCHES);
  });

  it('gives every team 19 home and 19 away matches', () => {
    const home = new Map<number, number>();
    const away = new Map<number, number>();
    for (const { homeTeamId, awayTeamId } of buildDoubleRoundRobin(teamIds).flat()) {
      home.set(homeTeamId, (home.get(homeTeamId) ?? 0) + 1);
      away.set(awayTeamId, (away.get(awayTeamId) ?? 0) + 1);
    }
    for (const id of teamIds) {
      expect(home.get(id)).toBe(19);
      expect(away.get(id)).toBe(19);
    }
  });

  it('plays each ordered pairing exactly once', () => {
    const ordered = buildDoubleRoundRobin(teamIds).flat().map((p) => `${p.homeTeamId}-${p.awayTeamId}`);
    expect(new Set(ordered).size).toBe(380);
  });
});

describe('generateFixtures', () => {
  it('numbers fixtures 1..380 in matchday order', () => {
    const fixtures = generateFixtures(teamIds);
    expect(fixtures).toHaveLength(TOTAL_MATCHES);
    expect(fixtures[0]!.matchNumber).toBe(1);
    expect(fixtures.at(-1)!.matchNumber).toBe(380);
    expect(fixtures[0]!.matchday).toBe(1);
    expect(fixtures.at(-1)!.matchday).toBe(38);
    for (let i = 1; i < fixtures.length; i++) {
      expect(fixtures[i]!.matchday).toBeGreaterThanOrEqual(fixtures[i - 1]!.matchday);
    }
  });

  it('spaces matchdays a week apart from the season start', () => {
    const fixtures = generateFixtures(teamIds, { seasonStart: '2026-08-15' });
    expect(fixtures[0]!.date).toBe('2026-08-15');
    expect(fixtures.find((f) => f.matchday === 2)!.date).toBe('2026-08-22');
  });

  it('never schedules a team against itself', () => {
    for (const fixture of generateFixtures(teamIds)) {
      expect(fixture.teamHomeId).not.toBe(fixture.teamAwayId);
    }
  });
});

describe('findNextMatchday', () => {
  const fixtures = generateFixtures([1, 2, 3, 4]);

  it('is the first matchday when nothing has been played', () => {
    expect(findNextMatchday(fixtures, new Set())).toBe(1);
  });

  it('advances once a whole matchday is played', () => {
    const matchday1 = fixtures.filter((f) => f.matchday === 1).map((f) => f.matchNumber);
    expect(findNextMatchday(fixtures, new Set(matchday1))).toBe(2);
  });

  it('stays put while any fixture from the round is outstanding', () => {
    // A postponement means "highest played + 1" would be wrong; the lowest gap wins.
    const played = fixtures
      .filter((f) => f.matchday <= 3)
      .map((f) => f.matchNumber)
      .slice(1);
    expect(findNextMatchday(fixtures, new Set(played))).toBe(1);
  });

  it('is null once every fixture is played', () => {
    expect(findNextMatchday(fixtures, new Set(fixtures.map((f) => f.matchNumber)))).toBeNull();
  });

  it('is null for an empty schedule', () => {
    expect(findNextMatchday([], new Set())).toBeNull();
  });
});
