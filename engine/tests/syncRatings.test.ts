import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyClubEloToTeamRecords,
  computeEloMoves,
  eloByClubeloName,
  parseClubEloCsv,
  selectPremierLeagueClubs,
  syncTeamRatingsFromClubElo,
} from '../src/data/fetchRatings.js';
import type { TeamCsvRecord } from '../src/data/teamsCsv.js';
import type { Repository } from '../src/db/repository.js';
import { createTestRepository } from './testDb.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

function clubEloCsv(
  rows: Array<{ club: string; elo: number; country?: string; level?: string }>,
): string {
  const header = 'Rank,Club,Country,Level,Elo,From,To';
  const body = rows.map(
    (row, index) =>
      `${index + 1},${row.club},${row.country ?? 'ENG'},${row.level ?? '1'},${row.elo},2024-01-01,2024-01-02`,
  );
  return [header, ...body].join('\n');
}

function sampleTeams(): TeamCsvRecord[] {
  return [
    { id: 1, name: 'Arsenal', shortName: 'ARS', clubeloName: 'Arsenal', elo: 2000 },
    { id: 2, name: 'Chelsea', shortName: 'CHE', clubeloName: 'Chelsea', elo: 1900 },
  ];
}

describe('applyClubEloToTeamRecords', () => {
  it('updates Elos by clubelo name without reshuffling ids', () => {
    const clubs = selectPremierLeagueClubs(
      parseClubEloCsv(
        clubEloCsv([
          { club: 'Chelsea', elo: 1955.5 },
          { club: 'Arsenal', elo: 2010 },
          { club: 'Other', elo: 1800, country: 'ESP' },
        ]),
      ),
    );

    const { teams, updated, unchanged } = applyClubEloToTeamRecords(
      sampleTeams(),
      eloByClubeloName(clubs),
    );

    expect(updated).toBe(2);
    expect(unchanged).toBe(0);
    expect(teams.map((t) => t.id)).toEqual([1, 2]);
    expect(teams[0]).toMatchObject({ clubeloName: 'Arsenal', elo: 2010 });
    expect(teams[1]).toMatchObject({ clubeloName: 'Chelsea', elo: 1955.5 });
  });

  it('throws when a seeded club is missing from clubelo', () => {
    expect(() =>
      applyClubEloToTeamRecords(sampleTeams(), eloByClubeloName([])),
    ).toThrow(/no Elo for "Arsenal"/);
  });
});

describe('syncTeamRatingsFromClubElo', () => {
  it('writes DB Elos and teams.csv for matching clubs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pls-ratings-'));
    const csvPath = join(dir, 'teams.csv');
    const existing = [
      { id: 1, name: 'Club 01', shortName: 'C01', clubeloName: 'Arsenal', elo: 2050 },
      { id: 2, name: 'Club 02', shortName: 'C02', clubeloName: 'Chelsea', elo: 1980 },
    ];
    writeFileSync(
      csvPath,
      'id,name,short_name,clubelo_name,elo\n' +
        existing.map((t) => `${t.id},"${t.name}",${t.shortName},"${t.clubeloName}",${t.elo}`).join('\n') +
        '\n',
    );

    const summary = await syncTeamRatingsFromClubElo({
      repo,
      csvPath,
      existingTeams: existing,
      clubEloCsv: clubEloCsv([
        { club: 'Arsenal', elo: 2100.25 },
        { club: 'Chelsea', elo: 1980 },
      ]),
    });

    expect(summary).toMatchObject({
      updated: 1,
      unchanged: 1,
      dryRun: false,
      csvPath,
    });
    expect(repo.getTeamsById().get(1)?.elo).toBe(2100.25);
    expect(repo.getTeamsById().get(2)?.elo).toBe(1980);
    expect(readFileSync(csvPath, 'utf8')).toContain('2100.25');
  });

  it('dry-run reports diffs without writing', async () => {
    const existing = sampleTeams();
    const before = repo.getTeamsById().get(1)!.elo;

    const summary = await syncTeamRatingsFromClubElo({
      repo,
      dryRun: true,
      writeCsv: false,
      existingTeams: existing,
      clubEloCsv: clubEloCsv([
        { club: 'Arsenal', elo: 2111 },
        { club: 'Chelsea', elo: 1911 },
      ]),
    });

    expect(summary).toMatchObject({ updated: 2, unchanged: 0, dryRun: true });
    expect(repo.getTeamsById().get(1)?.elo).toBe(before);
    expect(repo.getEloHistory()).toHaveLength(0);
  });

  it('records a dated Elo snapshot so past ratings survive the next overwrite', async () => {
    const existing = sampleTeams();

    await syncTeamRatingsFromClubElo({
      repo,
      writeCsv: false,
      date: new Date('2026-09-05T00:00:00Z'),
      existingTeams: existing,
      clubEloCsv: clubEloCsv([
        { club: 'Arsenal', elo: 2100 },
        { club: 'Chelsea', elo: 1850 },
      ]),
    });

    expect(repo.getEloHistoryDates()).toEqual(['2026-09-05']);
    expect(repo.getEloHistory(1)).toEqual([
      expect.objectContaining({ teamId: 1, asOf: '2026-09-05', elo: 2100 }),
    ]);

    // A later week appends rather than replacing, so the earlier rating is still readable
    // after teams.elo has moved on.
    await syncTeamRatingsFromClubElo({
      repo,
      writeCsv: false,
      date: new Date('2026-09-12T00:00:00Z'),
      existingTeams: existing,
      clubEloCsv: clubEloCsv([
        { club: 'Arsenal', elo: 2075 },
        { club: 'Chelsea', elo: 1860 },
      ]),
    });

    expect(repo.getEloHistoryDates()).toEqual(['2026-09-12', '2026-09-05']);
    expect(repo.getEloHistory(1).map((row) => row.elo)).toEqual([2100, 2075]);
  });

  it('re-running the same day overwrites rather than duplicating', async () => {
    const existing = sampleTeams();
    const run = () =>
      syncTeamRatingsFromClubElo({
        repo,
        writeCsv: false,
        date: new Date('2026-09-05T00:00:00Z'),
        existingTeams: existing,
        clubEloCsv: clubEloCsv([
          { club: 'Arsenal', elo: 2100 },
          { club: 'Chelsea', elo: 1850 },
        ]),
      });

    await run();
    await run();
    expect(repo.getEloHistory(1)).toHaveLength(1);
  });

  it('reports the biggest movers against the stored ratings', async () => {
    const summary = await syncTeamRatingsFromClubElo({
      repo,
      dryRun: true,
      writeCsv: false,
      existingTeams: [
        { id: 1, name: 'Club 01', shortName: 'C01', clubeloName: 'Arsenal', elo: 2050 },
        { id: 2, name: 'Club 02', shortName: 'C02', clubeloName: 'Chelsea', elo: 1980 },
      ],
      clubEloCsv: clubEloCsv([
        { club: 'Arsenal', elo: 2050.2 },
        { club: 'Chelsea', elo: 1930 },
      ]),
    });

    // Only Chelsea moved enough to be worth reporting; Arsenal drifted by 0.2.
    expect(summary.movers).toEqual([
      expect.objectContaining({ teamId: 2, from: 1980, to: 1930, delta: -50 }),
    ]);
  });
});

describe('computeEloMoves', () => {
  it('sorts by absolute move and ignores sub-point drift', () => {
    const moves = computeEloMoves(
      new Map([
        [1, 2000],
        [2, 1900],
        [3, 1800],
      ]),
      [
        { id: 1, name: 'A', shortName: 'A', clubeloName: 'A', elo: 2000.3 },
        { id: 2, name: 'B', shortName: 'B', clubeloName: 'B', elo: 1880 },
        { id: 3, name: 'C', shortName: 'C', clubeloName: 'C', elo: 1830 },
      ],
    );

    expect(moves.map((move) => move.name)).toEqual(['C', 'B']);
    expect(moves[0]!.delta).toBe(30);
  });

  it('skips teams with no stored rating to compare against', () => {
    const moves = computeEloMoves(new Map(), [
      { id: 1, name: 'A', shortName: 'A', clubeloName: 'A', elo: 2000 },
    ]);
    expect(moves).toEqual([]);
  });
});
