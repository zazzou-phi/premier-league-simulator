import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import type { Team } from '../engine/types.js';

interface TeamCsvRow {
  id: string;
  name: string;
  short_name: string;
  clubelo_name: string;
  elo: string;
}

/** Full teams.csv row including the clubelo join key. */
export interface TeamCsvRecord {
  id: number;
  name: string;
  shortName: string;
  clubeloName: string;
  elo: number;
}

export function getProjectDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(join(here, '../../../data'));
}

export function getDefaultTeamsCsvPath(): string {
  return join(getProjectDataDir(), 'teams.csv');
}

export function parseTeamsCsvRecords(csv: string): TeamCsvRecord[] {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as TeamCsvRow[];
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    shortName: row.short_name,
    clubeloName: row.clubelo_name,
    elo: Number(row.elo),
  }));
}

export function parseTeamsCsv(csv: string): Team[] {
  return parseTeamsCsvRecords(csv).map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    crest: null,
    elo: row.elo,
  }));
}

export function loadTeamsCsvRecords(path = getDefaultTeamsCsvPath()): TeamCsvRecord[] {
  return parseTeamsCsvRecords(readFileSync(path, 'utf8'));
}

export function loadTeams(path = getDefaultTeamsCsvPath()): Team[] {
  return parseTeamsCsv(readFileSync(path, 'utf8'));
}

export function teamCsvRecordsToCsv(teams: TeamCsvRecord[]): string {
  const header = 'id,name,short_name,clubelo_name,elo';
  const lines = teams.map(
    (team) =>
      `${team.id},"${team.name}",${team.shortName},"${team.clubeloName}",${team.elo.toFixed(2)}`,
  );
  return `${header}\n${lines.join('\n')}\n`;
}
