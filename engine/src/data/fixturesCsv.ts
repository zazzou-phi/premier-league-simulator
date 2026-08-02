import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Fixture, Team } from '../engine/types.js';
import { getProjectDataDir } from './teamsCsv.js';

/**
 * Names used by fixturedownload.com's EPL CSV, mapped to our display names.
 * clubelo names already cover most of these; the leftovers are CSV-specific aliases.
 */
export const FIXTURE_TEAM_ALIASES: Record<string, string> = {
  Arsenal: 'Arsenal',
  'Aston Villa': 'Aston Villa',
  Bournemouth: 'Bournemouth',
  Brentford: 'Brentford',
  Brighton: 'Brighton & Hove Albion',
  Chelsea: 'Chelsea',
  Coventry: 'Coventry City',
  'Crystal Palace': 'Crystal Palace',
  Everton: 'Everton',
  Fulham: 'Fulham',
  Hull: 'Hull City',
  Ipswich: 'Ipswich Town',
  Leeds: 'Leeds United',
  Liverpool: 'Liverpool',
  'Man City': 'Manchester City',
  'Man Utd': 'Manchester United',
  Newcastle: 'Newcastle United',
  "Nott'm Forest": 'Nottingham Forest',
  Spurs: 'Tottenham Hotspur',
  Sunderland: 'Sunderland',
};

interface FixtureCsvRow {
  'Match Number': string;
  'Round Number': string;
  Date: string;
  Location: string;
  'Home Team': string;
  'Away Team': string;
  Result?: string;
}

export function getDefaultFixturesCsvPath(): string {
  return join(getProjectDataDir(), 'fixtures.csv');
}

/** Parse `21/08/2026 20:00` into ISO date + HH:MM (UK wall-clock). */
export function parseFixtureKickoff(raw: string): { date: string; time: string } {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Unrecognized fixture kickoff format: ${raw}`);
  }
  const [, day, month, year, hour, minute] = match;
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour!.padStart(2, '0')}:${minute}`,
  };
}

export function resolveFixtureTeamName(csvName: string): string {
  const mapped = FIXTURE_TEAM_ALIASES[csvName];
  if (!mapped) {
    throw new Error(`Unknown fixture team name: ${csvName}`);
  }
  return mapped;
}

/** Parse fixturedownload `Result` cells (`1 - 0`). Empty → null; malformed → throw. */
export function parseFixtureResult(raw: string): { goalsHome: number; goalsAway: number } | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const match = trimmed.match(/^(\d+)\s+-\s+(\d+)$/);
  if (!match) {
    throw new Error(`Unrecognized fixture result format: ${raw}`);
  }
  return { goalsHome: Number(match[1]), goalsAway: Number(match[2]) };
}

export function parseCompletedResultsFromCsv(
  csv: string,
): Array<{ matchNumber: number; goalsHome: number; goalsAway: number }> {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as FixtureCsvRow[];

  const results: Array<{ matchNumber: number; goalsHome: number; goalsAway: number }> = [];
  for (const row of rows) {
    const score = parseFixtureResult(row.Result ?? '');
    if (!score) continue;
    const matchNumber = Number(row['Match Number']);
    if (!Number.isInteger(matchNumber) || matchNumber < 1) {
      throw new Error(`Invalid match number in results CSV: ${row['Match Number']}`);
    }
    results.push({ matchNumber, ...score });
  }
  results.sort((a, b) => a.matchNumber - b.matchNumber);
  return results;
}

export function parseFixturesCsv(csv: string, teams: Team[]): Fixture[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as FixtureCsvRow[];

  const byName = new Map(teams.map((team) => [team.name, team.id]));
  const fixtures: Fixture[] = [];

  for (const row of rows) {
    const homeName = resolveFixtureTeamName(row['Home Team']);
    const awayName = resolveFixtureTeamName(row['Away Team']);
    const homeId = byName.get(homeName);
    const awayId = byName.get(awayName);
    if (homeId == null) throw new Error(`No seeded team named ${homeName}`);
    if (awayId == null) throw new Error(`No seeded team named ${awayName}`);

    const { date, time } = parseFixtureKickoff(row.Date);
    fixtures.push({
      matchNumber: Number(row['Match Number']),
      matchday: Number(row['Round Number']),
      date,
      time,
      teamHomeId: homeId,
      teamAwayId: awayId,
    });
  }

  fixtures.sort((a, b) => a.matchNumber - b.matchNumber);
  validateFixtures(fixtures, teams);
  return fixtures;
}

function validateFixtures(fixtures: Fixture[], teams: Team[]): void {
  if (fixtures.length !== 380) {
    throw new Error(`Expected 380 fixtures, got ${fixtures.length}`);
  }
  const matchNumbers = new Set(fixtures.map((f) => f.matchNumber));
  if (matchNumbers.size !== 380) {
    throw new Error('Fixture match numbers are not unique');
  }

  const home = new Map<number, number>();
  const away = new Map<number, number>();
  const ordered = new Set<string>();
  for (const fixture of fixtures) {
    home.set(fixture.teamHomeId, (home.get(fixture.teamHomeId) ?? 0) + 1);
    away.set(fixture.teamAwayId, (away.get(fixture.teamAwayId) ?? 0) + 1);
    ordered.add(`${fixture.teamHomeId}-${fixture.teamAwayId}`);
  }
  for (const team of teams) {
    if (home.get(team.id) !== 19 || away.get(team.id) !== 19) {
      throw new Error(`${team.name} does not have 19 home and 19 away fixtures`);
    }
  }
  if (ordered.size !== 380) {
    throw new Error('Fixture list is missing unique home/away pairings');
  }
}

export function loadFixtures(teams: Team[], path = getDefaultFixturesCsvPath()): Fixture[] {
  return parseFixturesCsv(readFileSync(path, 'utf8'), teams);
}
