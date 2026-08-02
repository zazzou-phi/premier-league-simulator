import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Repository } from '../db/repository.js';
import { identityForClub } from './clubNames.js';
import {
  getDefaultTeamsCsvPath,
  loadTeamsCsvRecords,
  teamCsvRecordsToCsv,
  type TeamCsvRecord,
} from './teamsCsv.js';

export const CLUBELO_BASE_URL = 'http://api.clubelo.com';
export const PREMIER_LEAGUE_SIZE = 20;

export interface ClubEloRow {
  Rank: string;
  Club: string;
  Country: string;
  Level: string;
  Elo: string;
}

export interface TeamSeed {
  id: number;
  name: string;
  shortName: string;
  clubeloName: string;
  elo: number;
}

export function parseClubEloCsv(csv: string): ClubEloRow[] {
  return parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as ClubEloRow[];
}

/** clubelo marks the English top flight as country ENG at level 1. */
export function selectPremierLeagueClubs(rows: ClubEloRow[]): ClubEloRow[] {
  return rows
    .filter((row) => row.Country === 'ENG' && row.Level === '1')
    .sort((a, b) => Number(b.Elo) - Number(a.Elo));
}

export function toTeamSeeds(rows: ClubEloRow[]): TeamSeed[] {
  return rows.map((row, index) => {
    const identity = identityForClub(row.Club);
    return {
      id: index + 1,
      name: identity.name,
      shortName: identity.shortName,
      clubeloName: row.Club,
      elo: Number(row.Elo),
    };
  });
}

export async function fetchClubEloCsv(date = new Date()): Promise<string> {
  const day = date.toISOString().slice(0, 10);
  const response = await fetch(`${CLUBELO_BASE_URL}/${day}`);
  if (!response.ok) {
    throw new Error(`clubelo request failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export function teamSeedsToCsv(teams: TeamSeed[]): string {
  return teamCsvRecordsToCsv(teams);
}

export function eloByClubeloName(rows: ClubEloRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.Club, Number(row.Elo));
  }
  return out;
}

/**
 * Refresh Elo for the already-seeded squad without reshuffling team ids.
 * Matches `teams.csv` `clubelo_name` to clubelo.com club names.
 */
export function applyClubEloToTeamRecords(
  existing: TeamCsvRecord[],
  eloByClub: Map<string, number>,
): { teams: TeamCsvRecord[]; updated: number; unchanged: number } {
  let updated = 0;
  let unchanged = 0;
  const teams = existing.map((team) => {
    const nextElo = eloByClub.get(team.clubeloName);
    if (nextElo == null || Number.isNaN(nextElo)) {
      throw new Error(
        `clubelo has no Elo for "${team.clubeloName}" (${team.name}). ` +
          'Re-run fetch:ratings / reseed if the squad changed.',
      );
    }
    if (Math.abs(nextElo - team.elo) < 1e-9) {
      unchanged += 1;
      return team;
    }
    updated += 1;
    return { ...team, elo: nextElo };
  });
  return { teams, updated, unchanged };
}

export interface SyncRatingsSummary {
  updated: number;
  unchanged: number;
  dryRun: boolean;
  asOf: string;
  csvPath?: string;
  /** Teams written to `team_elo_history` under `asOf`. */
  snapshotted?: number;
  /** Largest Elo moves since the previous snapshot, biggest first. */
  movers?: EloMove[];
}

export interface EloMove {
  teamId: number;
  name: string;
  from: number;
  to: number;
  delta: number;
}

/** Elo moves between the stored ratings and the incoming ones, largest absolute move first. */
export function computeEloMoves(
  previous: Map<number, number>,
  next: TeamCsvRecord[],
  limit = 5,
): EloMove[] {
  return next
    .flatMap((team) => {
      const from = previous.get(team.id);
      if (from == null || Math.abs(team.elo - from) < 0.5) return [];
      return [{ teamId: team.id, name: team.name, from, to: team.elo, delta: team.elo - from }];
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

export interface SyncRatingsOptions {
  repo: Repository;
  dryRun?: boolean;
  /** When true (default), refresh data/teams.csv with updated Elos. */
  writeCsv?: boolean;
  csvPath?: string;
  date?: Date;
  /** Pre-fetched clubelo CSV body; when omitted, downloads. */
  clubEloCsv?: string;
  /** Pre-loaded teams.csv rows; when omitted, reads csvPath. */
  existingTeams?: TeamCsvRecord[];
}

export async function syncTeamRatingsFromClubElo(
  options: SyncRatingsOptions,
): Promise<SyncRatingsSummary> {
  const {
    repo,
    dryRun = false,
    writeCsv = true,
    csvPath = getDefaultTeamsCsvPath(),
    date = new Date(),
  } = options;

  const existing = options.existingTeams ?? loadTeamsCsvRecords(csvPath);
  const clubEloCsv = options.clubEloCsv ?? (await fetchClubEloCsv(date));
  const clubs = selectPremierLeagueClubs(parseClubEloCsv(clubEloCsv));
  const { teams, updated, unchanged } = applyClubEloToTeamRecords(
    existing,
    eloByClubeloName(clubs),
  );

  const asOf = date.toISOString().slice(0, 10);
  const before = new Map([...repo.getTeamsById()].map(([id, team]) => [id, team.elo]));
  const movers = computeEloMoves(before, teams);
  let snapshotted: number | undefined;

  if (!dryRun) {
    const byId = repo.getTeamsById();
    for (const team of teams) {
      const local = byId.get(team.id);
      if (!local) {
        throw new Error(
          `Team id ${team.id} (${team.name}) is in teams.csv but missing from the database. Run seed first.`,
        );
      }
      if (Math.abs(local.elo - team.elo) >= 1e-9) {
        repo.updateTeamElo(team.id, team.elo);
      }
    }

    // teams.elo is overwritten in place, so keep a dated copy of what the model just learned.
    snapshotted = repo.recordEloSnapshot(
      asOf,
      teams.map((team) => ({ teamId: team.id, elo: team.elo })),
    );

    if (writeCsv) {
      await mkdir(dirname(csvPath), { recursive: true });
      await writeFile(csvPath, teamCsvRecordsToCsv(teams), 'utf8');
    }
  }

  return {
    updated,
    unchanged,
    dryRun,
    asOf,
    csvPath: !dryRun && writeCsv ? csvPath : undefined,
    snapshotted,
    movers,
  };
}

export async function fetchAndWriteTeams(outPath: string, date = new Date()): Promise<TeamSeed[]> {
  const csv = await fetchClubEloCsv(date);
  const clubs = selectPremierLeagueClubs(parseClubEloCsv(csv));

  if (clubs.length !== PREMIER_LEAGUE_SIZE) {
    throw new Error(
      `Expected ${PREMIER_LEAGUE_SIZE} English top-flight clubs from clubelo, got ${clubs.length}`,
    );
  }

  const teams = toTeamSeeds(clubs);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, teamSeedsToCsv(teams), 'utf8');
  return teams;
}
