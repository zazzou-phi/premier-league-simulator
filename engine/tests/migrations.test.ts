import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { initSchema } from '../src/db/client.js';
import { DEFAULT_PICK_STRATEGY } from '../src/engine/pickStrategy.js';

let sqlite: Database.Database;

/** Insert a prediction carrying `strategy`, bypassing the repository so legacy values are allowed. */
function insertPrediction(strategy: string, name = 'Batch'): number {
  const info = sqlite
    .prepare(
      `INSERT INTO predictions
         (name, runs, pick_strategy, upset_variance, season_elo_delta_weight, created_at, updated_at)
       VALUES (?, 1000, ?, 0.2, 1, '2026-01-01', '2026-01-01')`,
    )
    .run(name, strategy);
  return Number(info.lastInsertRowid);
}

function strategyOf(id: number): string {
  return (
    sqlite.prepare(`SELECT pick_strategy AS strategy FROM predictions WHERE id = ?`).get(id) as {
      strategy: string;
    }
  ).strategy;
}

/** Rewind the migration marker so the next initSchema sees the database as pre-redesign. */
function simulateLegacyDatabase(): void {
  sqlite.pragma('user_version = 0');
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  initSchema(sqlite);
});

describe('pick strategy migration', () => {
  /** Put the column back under its pre-rename name, as an older build would have left it. */
  function simulateConsensusModeColumn(): void {
    sqlite.exec(`ALTER TABLE predictions RENAME COLUMN pick_strategy TO consensus_mode`);
  }

  it('renames consensus_mode to pick_strategy', () => {
    const id = insertPrediction('calibrated');
    simulateConsensusModeColumn();

    initSchema(sqlite);

    const columns = sqlite.prepare(`PRAGMA table_info(predictions)`).all() as Array<{
      name: string;
    }>;
    const names = new Set(columns.map((column) => column.name));
    expect(names.has('pick_strategy')).toBe(true);
    expect(names.has('consensus_mode')).toBe(false);
    expect(strategyOf(id)).toBe('calibrated');
  });

  it('maps the surviving pre-rename name onto its current one', () => {
    const id = insertPrediction('sample', 'Sample');

    initSchema(sqlite);

    expect(strategyOf(id)).toBe('random');
  });

  it('moves every withdrawn strategy onto the default', () => {
    const ids = [
      'maxPoints',
      'expectedPoints',
      'likeliestScore',
      'likeliestResult',
      'scoreline',
      'outcome',
    ].map((name) => insertPrediction(name, name));

    initSchema(sqlite);

    for (const id of ids) expect(strategyOf(id)).toBe(DEFAULT_PICK_STRATEGY);
  });

  it('moves batches off the superseded calibrated default, once', () => {
    const id = insertPrediction('calibrated', 'Ran under the old default');
    simulateLegacyDatabase();

    initSchema(sqlite);
    expect(strategyOf(id)).toBe('plausible');

    // Choosing calibrated deliberately afterwards must survive every later open.
    sqlite.prepare(`UPDATE predictions SET pick_strategy = 'calibrated' WHERE id = ?`).run(id);
    initSchema(sqlite);
    initSchema(sqlite);
    expect(strategyOf(id)).toBe('calibrated');
  });

  it('leaves a deliberate choice of a current strategy alone on later opens', () => {
    const id = insertPrediction('likeliestScore');
    simulateLegacyDatabase();
    initSchema(sqlite);
    expect(strategyOf(id)).toBe(DEFAULT_PICK_STRATEGY);

    // The user switches to calibrated. Reopening must not undo that.
    sqlite.prepare(`UPDATE predictions SET pick_strategy = 'calibrated' WHERE id = ?`).run(id);
    initSchema(sqlite);
    initSchema(sqlite);

    expect(strategyOf(id)).toBe('calibrated');
  });

  it('remaps strategies that no longer exist on every open', () => {
    const floor = insertPrediction('floor', 'Floor');
    const rounded = insertPrediction('rounded', 'Rounded');

    initSchema(sqlite);

    expect(strategyOf(floor)).toBe(DEFAULT_PICK_STRATEGY);
    expect(strategyOf(rounded)).toBe(DEFAULT_PICK_STRATEGY);
  });

  it('records the migration so a fresh database is never backfilled', () => {
    expect(sqlite.pragma('user_version', { simple: true })).toBe(3);

    // A batch created after the migration keeps whatever strategy it was given.
    const id = insertPrediction('random');
    initSchema(sqlite);

    expect(strategyOf(id)).toBe('random');
  });
});

describe('predictor payoff removal', () => {
  /** Put the payoff columns back, so the next initSchema sees a database that still has them. */
  function addScoringRulesColumns(table: string): void {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN exact_score_points REAL NOT NULL DEFAULT 3`);
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN correct_result_points REAL NOT NULL DEFAULT 1`);
  }

  const columnsOf = (table: string) =>
    new Set(
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );

  it('drops the payoff columns from predictions, leaving the batch itself intact', () => {
    const id = insertPrediction('calibrated', 'Carried over');
    addScoringRulesColumns('predictions');

    initSchema(sqlite);

    const columns = columnsOf('predictions');
    expect(columns.has('exact_score_points')).toBe(false);
    expect(columns.has('correct_result_points')).toBe(false);

    const row = sqlite
      .prepare(`SELECT name, pick_strategy AS strategy FROM predictions WHERE id = ?`)
      .get(id) as { name: string; strategy: string };
    expect(row).toEqual({ name: 'Carried over', strategy: 'calibrated' });
  });

  it('drops them from settings without disturbing the other values', () => {
    sqlite
      .prepare(
        `INSERT INTO app_settings (id, upset_variance, season_elo_delta_weight) VALUES (1, 0.35, 2)`,
      )
      .run();
    addScoringRulesColumns('app_settings');

    initSchema(sqlite);

    expect(columnsOf('app_settings').has('exact_score_points')).toBe(false);
    const row = sqlite
      .prepare(
        `SELECT upset_variance AS upset, season_elo_delta_weight AS weight
           FROM app_settings WHERE id = 1`,
      )
      .get() as { upset: number; weight: number };
    expect(row).toEqual({ upset: 0.35, weight: 2 });
  });

  it('is idempotent across repeated opens', () => {
    addScoringRulesColumns('predictions');
    initSchema(sqlite);
    expect(() => initSchema(sqlite)).not.toThrow();
    expect(columnsOf('predictions').has('exact_score_points')).toBe(false);
  });
});
