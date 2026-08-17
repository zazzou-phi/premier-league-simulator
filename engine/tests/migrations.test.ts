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
    const id = insertPrediction('likeliestResult');
    simulateConsensusModeColumn();

    initSchema(sqlite);

    const columns = sqlite.prepare(`PRAGMA table_info(predictions)`).all() as Array<{
      name: string;
    }>;
    const names = new Set(columns.map((column) => column.name));
    expect(names.has('pick_strategy')).toBe(true);
    expect(names.has('consensus_mode')).toBe(false);
    expect(strategyOf(id)).toBe('likeliestResult');
  });

  it('maps every pre-rename strategy name onto its current one', () => {
    const ids = {
      scoreline: insertPrediction('scoreline', 'Scoreline'),
      outcome: insertPrediction('outcome', 'Outcome'),
      expectedPoints: insertPrediction('expectedPoints', 'Expected points'),
      sample: insertPrediction('sample', 'Sample'),
    };

    initSchema(sqlite);

    expect(strategyOf(ids.scoreline)).toBe('likeliestScore');
    expect(strategyOf(ids.outcome)).toBe('likeliestResult');
    expect(strategyOf(ids.expectedPoints)).toBe('maxPoints');
    expect(strategyOf(ids.sample)).toBe('random');
  });

  it('moves legacy scoreline batches onto the default of the build that introduced the step', () => {
    const id = insertPrediction('scoreline');
    simulateLegacyDatabase();

    initSchema(sqlite);

    expect(strategyOf(id)).toBe('likeliestResult');
  });

  it('leaves a deliberate switch back to the likeliest score alone on later opens', () => {
    const id = insertPrediction('scoreline');
    simulateLegacyDatabase();
    initSchema(sqlite);
    expect(strategyOf(id)).toBe('likeliestResult');

    // The user picks the likeliest score again. Reopening must not undo that.
    sqlite.prepare(`UPDATE predictions SET pick_strategy = 'likeliestScore' WHERE id = ?`).run(id);
    initSchema(sqlite);
    initSchema(sqlite);

    expect(strategyOf(id)).toBe('likeliestScore');
  });

  it('remaps strategies that no longer exist on every open', () => {
    const floor = insertPrediction('floor', 'Floor');
    const rounded = insertPrediction('rounded', 'Rounded');

    initSchema(sqlite);

    expect(strategyOf(floor)).toBe(DEFAULT_PICK_STRATEGY);
    expect(strategyOf(rounded)).toBe(DEFAULT_PICK_STRATEGY);
  });

  it('records the migration so a fresh database is never backfilled', () => {
    expect(sqlite.pragma('user_version', { simple: true })).toBe(2);

    // A batch created after the migration keeps whatever strategy it was given.
    const id = insertPrediction('likeliestScore');
    initSchema(sqlite);

    expect(strategyOf(id)).toBe('likeliestScore');
  });
});

describe('predictor points migration', () => {
  /** Strip the payoff columns so the next initSchema sees a pre-maxPoints database. */
  function dropScoringRulesColumns(table: string): void {
    sqlite.exec(`ALTER TABLE ${table} DROP COLUMN exact_score_points`);
    sqlite.exec(`ALTER TABLE ${table} DROP COLUMN correct_result_points`);
  }

  it('adds the payoff columns to predictions carried over from before the mode', () => {
    const id = insertPrediction('likeliestResult');
    dropScoringRulesColumns('predictions');

    initSchema(sqlite);

    const row = sqlite
      .prepare(
        `SELECT exact_score_points AS exact, correct_result_points AS result
           FROM predictions WHERE id = ?`,
      )
      .get(id) as { exact: number; result: number };
    expect(row).toEqual({ exact: 3, result: 1 });
  });

  it('adds the payoff columns to existing settings without touching the other values', () => {
    sqlite
      .prepare(
        `INSERT INTO app_settings (id, upset_variance, season_elo_delta_weight) VALUES (1, 0.35, 2)`,
      )
      .run();
    dropScoringRulesColumns('app_settings');

    initSchema(sqlite);

    const row = sqlite
      .prepare(
        `SELECT upset_variance AS upset, exact_score_points AS exact, correct_result_points AS result
           FROM app_settings WHERE id = 1`,
      )
      .get() as { upset: number; exact: number; result: number };
    expect(row).toEqual({ upset: 0.35, exact: 3, result: 1 });
  });

  it('is idempotent across repeated opens', () => {
    dropScoringRulesColumns('predictions');
    initSchema(sqlite);
    expect(() => initSchema(sqlite)).not.toThrow();
  });
});
