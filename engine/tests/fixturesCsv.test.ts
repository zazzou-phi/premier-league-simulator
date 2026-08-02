import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getDefaultFixturesCsvPath,
  parseCompletedResultsFromCsv,
  parseFixtureKickoff,
  parseFixtureResult,
  parseFixturesCsv,
  resolveFixtureTeamName,
} from '../src/data/fixturesCsv.js';
import { loadTeams } from '../src/data/teamsCsv.js';

describe('parseFixtureKickoff', () => {
  it('parses UK wall-clock kickoffs into ISO date and HH:MM', () => {
    expect(parseFixtureKickoff('21/08/2026 20:00')).toEqual({
      date: '2026-08-21',
      time: '20:00',
    });
    expect(parseFixtureKickoff('22/08/2026 12:30')).toEqual({
      date: '2026-08-22',
      time: '12:30',
    });
  });
});

describe('parseFixtureResult', () => {
  it('parses completed scores and treats empty as unfinished', () => {
    expect(parseFixtureResult('1 - 0')).toEqual({ goalsHome: 1, goalsAway: 0 });
    expect(parseFixtureResult(' 4 - 2 ')).toEqual({ goalsHome: 4, goalsAway: 2 });
    expect(parseFixtureResult('0 - 0')).toEqual({ goalsHome: 0, goalsAway: 0 });
    expect(parseFixtureResult('')).toBeNull();
    expect(parseFixtureResult('   ')).toBeNull();
  });

  it('rejects malformed result cells', () => {
    expect(() => parseFixtureResult('1-0')).toThrow(/Unrecognized fixture result/);
    expect(() => parseFixtureResult('2:1')).toThrow(/Unrecognized fixture result/);
  });
});

describe('parseCompletedResultsFromCsv', () => {
  it('returns only rows with a completed Result', () => {
    const csv = [
      'Match Number,Round Number,Date,Location,Home Team,Away Team,Result',
      '1,1,16/08/2024 20:00,Old Trafford,Man Utd,Fulham,1 - 0',
      '2,1,17/08/2024 12:30,Portman Road,Ipswich,Liverpool,',
      '3,1,17/08/2024 15:00,Emirates Stadium,Arsenal,Wolves,2 - 0',
    ].join('\n');

    expect(parseCompletedResultsFromCsv(csv)).toEqual([
      { matchNumber: 1, goalsHome: 1, goalsAway: 0 },
      { matchNumber: 3, goalsHome: 2, goalsAway: 0 },
    ]);
  });
});

describe('resolveFixtureTeamName', () => {
  it('maps fixturedownload aliases onto display names', () => {
    expect(resolveFixtureTeamName('Man Utd')).toBe('Manchester United');
    expect(resolveFixtureTeamName("Nott'm Forest")).toBe('Nottingham Forest');
    expect(resolveFixtureTeamName('Spurs')).toBe('Tottenham Hotspur');
  });
});

describe('parseFixturesCsv', () => {
  it('loads the 2026/27 Premier League fixture list', () => {
    const teams = loadTeams();
    const csv = readFileSync(getDefaultFixturesCsvPath(), 'utf8');
    const fixtures = parseFixturesCsv(csv, teams);

    expect(fixtures).toHaveLength(380);
    expect(fixtures[0]).toMatchObject({
      matchNumber: 1,
      matchday: 1,
      date: '2026-08-21',
      time: '20:00',
    });
    expect(fixtures[0]!.teamHomeId).toBe(teams.find((t) => t.name === 'Arsenal')!.id);
    expect(fixtures[0]!.teamAwayId).toBe(teams.find((t) => t.name === 'Coventry City')!.id);

    const last = fixtures[fixtures.length - 1]!;
    expect(last).toMatchObject({
      matchNumber: 380,
      matchday: 38,
      date: '2027-05-30',
      time: '16:00',
    });
    expect(fixtures.every((f) => f.matchday >= 1 && f.matchday <= 38)).toBe(true);
  });
});
