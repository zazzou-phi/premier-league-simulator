import { describe, expect, it } from 'vitest';
import {
  computeFinalPositions,
  computeLeagueStandings,
  zoneForPosition,
  type PlayedMatch,
} from '../src/engine/standings.js';
import type { Team } from '../src/engine/types.js';

function team(id: number, name: string): Team {
  return {
    id,
    name,
    shortName: name.slice(0, 3).toUpperCase(),
    crest: null,
    elo: 1500,
  };
}

const alpha = team(1, 'Alpha');
const bravo = team(2, 'Bravo');
const charlie = team(3, 'Charlie');
const delta = team(4, 'Delta');
const teams = [alpha, bravo, charlie, delta];

function match(home: Team, away: Team, goalsHome: number, goalsAway: number): PlayedMatch {
  return { homeTeamId: home.id, awayTeamId: away.id, goalsHome, goalsAway };
}

describe('computeLeagueStandings', () => {
  it('starts everyone on zero before any match', () => {
    const rows = computeLeagueStandings(teams, []);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.played).toBe(0);
      expect(row.points).toBe(0);
    }
  });

  it('awards three points for a win and one for a draw', () => {
    const rows = computeLeagueStandings(teams, [
      match(alpha, bravo, 2, 0),
      match(charlie, delta, 1, 1),
    ]);
    const byName = new Map(rows.map((row) => [row.team.name, row]));
    expect(byName.get('Alpha')!.points).toBe(3);
    expect(byName.get('Alpha')!.won).toBe(1);
    expect(byName.get('Bravo')!.points).toBe(0);
    expect(byName.get('Bravo')!.lost).toBe(1);
    expect(byName.get('Charlie')!.points).toBe(1);
    expect(byName.get('Charlie')!.drawn).toBe(1);
  });

  it('accumulates goals for and against from both sides', () => {
    const rows = computeLeagueStandings(teams, [match(alpha, bravo, 3, 1)]);
    const byName = new Map(rows.map((row) => [row.team.name, row]));
    expect(byName.get('Alpha')!.goalsFor).toBe(3);
    expect(byName.get('Alpha')!.goalsAgainst).toBe(1);
    expect(byName.get('Alpha')!.goalDifference).toBe(2);
    expect(byName.get('Bravo')!.goalsFor).toBe(1);
    expect(byName.get('Bravo')!.goalDifference).toBe(-2);
  });

  it('ranks on points first', () => {
    const rows = computeLeagueStandings(teams, [
      match(bravo, alpha, 1, 0),
      match(bravo, charlie, 1, 0),
      match(alpha, delta, 5, 0),
    ]);
    expect(rows[0]!.team.name).toBe('Bravo');
    expect(rows[0]!.points).toBe(6);
  });

  it('breaks equal points on overall goal difference, not head-to-head', () => {
    // Both finish on 4 points. Bravo won the head-to-head, Alpha has the better
    // goal difference, and the Premier League ranks on goal difference.
    const rows = computeLeagueStandings(teams, [
      match(bravo, alpha, 1, 0),
      match(alpha, charlie, 6, 0),
      match(delta, alpha, 0, 0),
      match(charlie, bravo, 0, 0),
      match(delta, bravo, 1, 0),
    ]);
    const alphaRow = rows.find((row) => row.team.name === 'Alpha')!;
    const bravoRow = rows.find((row) => row.team.name === 'Bravo')!;
    expect(alphaRow.points).toBe(bravoRow.points);
    expect(alphaRow.goalDifference).toBeGreaterThan(bravoRow.goalDifference);
    expect(alphaRow.position).toBeLessThan(bravoRow.position);
  });

  it('breaks equal points and goal difference on goals scored', () => {
    const rows = computeLeagueStandings([alpha, bravo], [
      match(alpha, bravo, 3, 1),
      match(bravo, alpha, 3, 1),
    ]);
    // Both on 3 points and level goal difference; identical goals scored falls to name.
    expect(rows[0]!.goalsFor).toBe(rows[1]!.goalsFor);
    expect(rows[0]!.team.name).toBe('Alpha');
  });

  it('assigns sequential positions', () => {
    const rows = computeLeagueStandings(teams, [match(alpha, bravo, 1, 0)]);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3, 4]);
  });

  it('ignores matches involving unknown teams', () => {
    const rows = computeLeagueStandings(teams, [
      { homeTeamId: 99, awayTeamId: alpha.id, goalsHome: 5, goalsAway: 0 },
    ]);
    expect(rows.every((row) => row.played === 0)).toBe(true);
  });
});

describe('computeFinalPositions', () => {
  it('maps every team to its finishing position', () => {
    const positions = computeFinalPositions(teams, [match(alpha, bravo, 1, 0)]);
    expect(positions.size).toBe(4);
    expect(positions.get(alpha.id)).toBe(1);
    expect(new Set(positions.values())).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe('zoneForPosition', () => {
  it('classifies the Premier League zones', () => {
    expect(zoneForPosition(1)).toBe('champion');
    expect(zoneForPosition(2)).toBe('championsLeague');
    expect(zoneForPosition(4)).toBe('championsLeague');
    expect(zoneForPosition(5)).toBe('europaLeague');
    expect(zoneForPosition(10)).toBe('midtable');
    expect(zoneForPosition(17)).toBe('midtable');
    expect(zoneForPosition(18)).toBe('relegation');
    expect(zoneForPosition(20)).toBe('relegation');
  });
});
