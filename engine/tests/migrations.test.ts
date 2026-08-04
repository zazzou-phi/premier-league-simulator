import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { initSchema } from '../src/db/client.js';

let sqlite: Database.Database;

/** Insert a prediction carrying `mode`, bypassing the repository so legacy values are allowed. */
function insertPrediction(mode: string, name = 'Batch'): number {
  const info = sqlite
    .prepare(
      `INSERT INTO predictions
         (name, runs, consensus_mode, upset_variance, season_elo_delta_weight, created_at, updated_at)
       VALUES (?, 1000, ?, 0.2, 1, '2026-01-01', '2026-01-01')`,
    )
    .run(name, mode);
  return Number(info.lastInsertRowid);
}

function modeOf(id: number): string {
  return (
    sqlite.prepare(`SELECT consensus_mode AS mode FROM predictions WHERE id = ?`).get(id) as {
      mode: string;
    }
  ).mode;
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

describe('consensus mode migration', () => {
  it('moves legacy scoreline batches onto the current default', () => {
    const id = insertPrediction('scoreline');
    simulateLegacyDatabase();

    initSchema(sqlite);

    expect(modeOf(id)).toBe('outcome');
  });

  it('leaves a deliberate switch back to scoreline alone on later opens', () => {
    const id = insertPrediction('scoreline');
    simulateLegacyDatabase();
    initSchema(sqlite);
    expect(modeOf(id)).toBe('outcome');

    // The user picks scoreline again. Reopening the database must not undo that.
    sqlite.prepare(`UPDATE predictions SET consensus_mode = 'scoreline' WHERE id = ?`).run(id);
    initSchema(sqlite);
    initSchema(sqlite);

    expect(modeOf(id)).toBe('scoreline');
  });

  it('remaps removed floor and rounded modes on every open', () => {
    const floor = insertPrediction('floor', 'Floor');
    const rounded = insertPrediction('rounded', 'Rounded');

    initSchema(sqlite);

    expect(modeOf(floor)).toBe('outcome');
    expect(modeOf(rounded)).toBe('outcome');
  });

  it('records the migration so a fresh database is never backfilled', () => {
    expect(sqlite.pragma('user_version', { simple: true })).toBe(1);

    // A batch created after the migration keeps whatever mode it was given.
    const id = insertPrediction('scoreline');
    initSchema(sqlite);

    expect(modeOf(id)).toBe('scoreline');
  });
});
