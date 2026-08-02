import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { initSchema } from '../src/db/client.js';
import { Repository } from '../src/db/repository.js';
import * as schema from '../src/db/schema.js';
import { generateFixtures } from '../src/engine/schedule.js';
import type { Team } from '../src/engine/types.js';

export const TEST_ELOS = [
  2050, 1980, 1940, 1920, 1900, 1880, 1860, 1845, 1830, 1820, 1810, 1800, 1790, 1780, 1770, 1755,
  1730, 1680, 1640, 1540,
];

export function makeTestTeams(): Team[] {
  return TEST_ELOS.map((elo, index) => ({
    id: index + 1,
    name: `Club ${String(index + 1).padStart(2, '0')}`,
    shortName: `C${String(index + 1).padStart(2, '0')}`,
    crest: null,
    elo,
  }));
}

/** In-memory database seeded with 20 synthetic clubs and a full 380-fixture season. */
export function createTestRepository(): { repo: Repository; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  initSchema(sqlite);

  const teams = makeTestTeams();
  const fixtures = generateFixtures(teams.map((team) => team.id));

  const insertTeam = sqlite.prepare(
    `INSERT INTO teams (id, name, short_name, crest, elo)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const team of teams) {
    insertTeam.run(team.id, team.name, team.shortName, team.crest, team.elo);
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

  sqlite
    .prepare(
      `INSERT INTO app_settings (id, upset_variance, season_elo_delta_weight) VALUES (1, 0.2, 1)`,
    )
    .run();

  return { repo: new Repository(drizzle(sqlite, { schema })), sqlite };
}
