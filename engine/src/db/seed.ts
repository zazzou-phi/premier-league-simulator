import type Database from 'better-sqlite3';
import { DEFAULT_UPSET_VARIANCE } from '../engine/matchSimulator.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from '../engine/seasonElo.js';
import { getDefaultFixturesCsvPath, loadFixtures } from '../data/fixturesCsv.js';
import { getDefaultTeamsCsvPath, loadTeams } from '../data/teamsCsv.js';
import type { Team } from '../engine/types.js';

export interface SeedOptions {
  teamsCsvPath?: string;
  fixturesCsvPath?: string;
  /** Wipe and reload teams and fixtures even if they already exist. */
  force?: boolean;
}

function hasRows(sqlite: Database.Database, table: string): boolean {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n > 0;
}

export function seedSettings(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO app_settings (id, upset_variance, season_elo_delta_weight)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(DEFAULT_UPSET_VARIANCE, DEFAULT_SEASON_ELO_DELTA_WEIGHT);
}

export function seedTeamsAndFixtures(
  sqlite: Database.Database,
  options: SeedOptions = {},
): { teams: Team[]; fixtures: number } {
  const alreadySeeded = hasRows(sqlite, 'teams') && hasRows(sqlite, 'fixtures');
  if (alreadySeeded && !options.force) {
    const teams = sqlite.prepare('SELECT * FROM teams ORDER BY id').all() as Array<{
      id: number;
      name: string;
      short_name: string;
      crest: string | null;
      elo: number;
    }>;
    const fixtureCount = sqlite.prepare('SELECT COUNT(*) AS n FROM fixtures').get() as { n: number };
    return {
      teams: teams.map((row) => ({
        id: row.id,
        name: row.name,
        shortName: row.short_name,
        crest: row.crest,
        elo: row.elo,
      })),
      fixtures: fixtureCount.n,
    };
  }

  const teams = loadTeams(options.teamsCsvPath ?? getDefaultTeamsCsvPath());
  const fixtures = loadFixtures(teams, options.fixturesCsvPath ?? getDefaultFixturesCsvPath());

  const reseed = sqlite.transaction(() => {
    sqlite.exec(`
      DELETE FROM prediction_sampled_seasons;
      DELETE FROM prediction_active_sample;
      DELETE FROM prediction_team_stats;
      DELETE FROM prediction_team_positions;
      DELETE FROM prediction_match_scorelines;
      DELETE FROM prediction_match_outcomes;
      DELETE FROM prediction_locked_matches;
      DELETE FROM predictions;
      DELETE FROM simulation_matches;
      DELETE FROM simulations;
      DELETE FROM actual_match_results;
      DELETE FROM team_elo_history;
      DELETE FROM fixtures;
      DELETE FROM teams;
    `);

    const insertTeam = sqlite.prepare(
      `INSERT INTO teams (id, name, short_name, crest, elo)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const team of teams) {
      insertTeam.run(team.id, team.name, team.shortName, team.crest, team.elo);
    }

    // Baseline snapshot so Elo history is not empty before the first weekly sync.
    const now = new Date().toISOString();
    const insertEloSnapshot = sqlite.prepare(
      `INSERT INTO team_elo_history (team_id, as_of, elo, recorded_at) VALUES (?, ?, ?, ?)`,
    );
    for (const team of teams) {
      insertEloSnapshot.run(team.id, now.slice(0, 10), team.elo, now);
    }

    const insertFixture = sqlite.prepare(
      `INSERT INTO fixtures (match_number, matchday, date, time, team_home_id, team_away_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const fixture of fixtures) {
      insertFixture.run(
        fixture.matchNumber,
        fixture.matchday,
        fixture.date,
        fixture.time,
        fixture.teamHomeId,
        fixture.teamAwayId,
      );
    }
  });

  reseed();
  return { teams, fixtures: fixtures.length };
}

export function seedDatabase(sqlite: Database.Database, options: SeedOptions = {}): void {
  seedTeamsAndFixtures(sqlite, options);
  seedSettings(sqlite);
}
