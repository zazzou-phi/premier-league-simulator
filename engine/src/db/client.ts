import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getProjectDataDir } from '../data/teamsCsv.js';
import {
  DEFAULT_PICK_STRATEGY,
  PICK_STRATEGIES,
  type PickStrategy,
} from '../engine/pickStrategy.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export function getDefaultDbPath(): string {
  return join(getProjectDataDir(), 'premier-league.db');
}

export function initSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      crest TEXT,
      elo REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fixtures (
      match_number INTEGER PRIMARY KEY,
      matchday INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      team_home_id INTEGER NOT NULL REFERENCES teams(id),
      team_away_id INTEGER NOT NULL REFERENCES teams(id)
    );

    CREATE INDEX IF NOT EXISTS idx_fixtures_matchday ON fixtures(matchday);

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY,
      upset_variance REAL NOT NULL,
      season_elo_delta_weight REAL NOT NULL,
      exact_score_points REAL NOT NULL DEFAULT 3,
      correct_result_points REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS simulations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS simulation_matches (
      simulation_id INTEGER NOT NULL REFERENCES simulations(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      team_home_id INTEGER NOT NULL REFERENCES teams(id),
      team_away_id INTEGER NOT NULL REFERENCES teams(id),
      goals_home INTEGER,
      goals_away INTEGER,
      status TEXT NOT NULL,
      PRIMARY KEY (simulation_id, match_number)
    );

    CREATE TABLE IF NOT EXISTS team_elo_history (
      team_id INTEGER NOT NULL REFERENCES teams(id),
      as_of TEXT NOT NULL,
      elo REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (team_id, as_of)
    );

    CREATE INDEX IF NOT EXISTS idx_team_elo_history_as_of ON team_elo_history(as_of);

    CREATE TABLE IF NOT EXISTS actual_match_results (
      match_number INTEGER PRIMARY KEY REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      runs INTEGER NOT NULL,
      pick_strategy TEXT NOT NULL DEFAULT 'calibrated',
      upset_variance REAL NOT NULL,
      season_elo_delta_weight REAL NOT NULL,
      exact_score_points REAL NOT NULL DEFAULT 3,
      correct_result_points REAL NOT NULL DEFAULT 1,
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      as_of_matchday INTEGER,
      locked_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prediction_locked_matches (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      PRIMARY KEY (prediction_id, match_number)
    );

    CREATE TABLE IF NOT EXISTS prediction_match_outcomes (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      home_win INTEGER NOT NULL,
      draw INTEGER NOT NULL,
      away_win INTEGER NOT NULL,
      total INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, match_number)
    );

    CREATE TABLE IF NOT EXISTS prediction_match_scorelines (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, match_number, goals_home, goals_away)
    );

    CREATE TABLE IF NOT EXISTS prediction_team_positions (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      position INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, team_id, position)
    );

    CREATE TABLE IF NOT EXISTS prediction_team_stats (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      total_points INTEGER NOT NULL,
      total_goals_for INTEGER NOT NULL,
      total_goals_against INTEGER NOT NULL,
      position_sum INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS prediction_sampled_seasons (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      sample_index INTEGER NOT NULL,
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, sample_index, match_number)
    );

    CREATE TABLE IF NOT EXISTS prediction_active_sample (
      prediction_id INTEGER PRIMARY KEY REFERENCES predictions(id),
      sample_index INTEGER NOT NULL
    );
  `);

  migrateDropTeamRatingColumns(sqlite);
  migratePickStrategies(sqlite);
  migratePredictionProvenance(sqlite);
  migrateScoringRules(sqlite);
}

/**
 * Add the predictor-game payoff columns to tables created before the `maxPoints` strategy.
 * Existing rows take the defaults, which is right: they predate the mode and never used it.
 */
function migrateScoringRules(sqlite: Database.Database): void {
  for (const table of ['app_settings', 'predictions']) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('exact_score_points')) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN exact_score_points REAL NOT NULL DEFAULT 3`);
    }
    if (!names.has('correct_result_points')) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN correct_result_points REAL NOT NULL DEFAULT 1`);
    }
  }
}

/** Add the provenance columns to `predictions` tables created before weekly scoring. */
function migratePredictionProvenance(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(predictions)`).all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('as_of_matchday')) {
    sqlite.exec(`ALTER TABLE predictions ADD COLUMN as_of_matchday INTEGER`);
  }
  if (!names.has('locked_count')) {
    sqlite.exec(`ALTER TABLE predictions ADD COLUMN locked_count INTEGER NOT NULL DEFAULT 0`);
  }
}

/** Drop legacy attack/defence columns from DBs created before Elo-difference lambdas. */
function migrateDropTeamRatingColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(teams)`).all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (names.has('offensive_rating')) {
    sqlite.exec(`ALTER TABLE teams DROP COLUMN offensive_rating`);
  }
  if (names.has('defensive_rating')) {
    sqlite.exec(`ALTER TABLE teams DROP COLUMN defensive_rating`);
  }
}

/**
 * Schema revisions applied by `migratePickStrategies`, tracked in `PRAGMA user_version`.
 * Bump when adding a step below; existing databases run only the steps they have not seen.
 */
const PICK_STRATEGY_SCHEMA_VERSION = 2;

/** Pre-rename strategy names, in the order the value migration maps them. */
const RENAMED_STRATEGIES: Array<[legacy: string, current: PickStrategy]> = [
  ['scoreline', 'likeliestScore'],
  ['outcome', 'likeliestResult'],
  ['expectedPoints', 'maxPoints'],
  ['sample', 'random'],
];

/** `consensus_mode` became `pick_strategy` when the modes were renamed. */
function renameConsensusModeColumn(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(predictions)`).all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (names.has('consensus_mode') && !names.has('pick_strategy')) {
    sqlite.exec(`ALTER TABLE predictions RENAME COLUMN consensus_mode TO pick_strategy`);
  }
}

/**
 * Bring stored strategy names up to date: rename the column, map the old mode names onto the
 * current ones, and drop anything unrecognised onto the default.
 *
 * The name mapping runs unconditionally rather than under the version guard. It is a pure
 * translation — the legacy names are no longer valid values, so re-running it is a no-op — and
 * that keeps it correct for a database written by an older build after this one has already
 * stamped its version.
 */
function migratePickStrategies(sqlite: Database.Database): void {
  renameConsensusModeColumn(sqlite);

  const version = sqlite.pragma('user_version', { simple: true }) as number;

  // Pre-redesign batches defaulted to `scoreline`, which collapses most fixtures to 1–1 and
  // produces a table full of draws. Move them onto the mode the app then defaulted to. Guarded
  // rather than unconditional: past this point `scoreline` is a deliberate user choice, and
  // re-running would silently revert it on the next restart.
  if (version < 1) {
    sqlite
      .prepare(`UPDATE predictions SET pick_strategy = 'outcome' WHERE pick_strategy = 'scoreline'`)
      .run();
  }

  const rename = sqlite.prepare(`UPDATE predictions SET pick_strategy = ? WHERE pick_strategy = ?`);
  for (const [legacy, current] of RENAMED_STRATEGIES) rename.run(current, legacy);

  // Catch-all for strategies that have been removed outright, such as the old floor/rounded pair.
  const placeholders = PICK_STRATEGIES.map(() => '?').join(', ');
  sqlite
    .prepare(`UPDATE predictions SET pick_strategy = ? WHERE pick_strategy NOT IN (${placeholders})`)
    .run(DEFAULT_PICK_STRATEGY, ...PICK_STRATEGIES);

  if (version < PICK_STRATEGY_SCHEMA_VERSION) {
    sqlite.pragma(`user_version = ${PICK_STRATEGY_SCHEMA_VERSION}`);
  }
}

export function openDatabase(dbPath = getDefaultDbPath()): {
  sqlite: Database.Database;
  db: Db;
} {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  initSchema(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
