import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Repository } from '../src/db/repository.js';
import {
  countWeekSteps,
  getDefaultSnapshotDir,
  RemoteResultsChangedError,
  runWeek,
  type WeekRunEvent,
} from '../src/season/weekRun.js';
import { createTestRepository } from './testDb.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

/** Completed scorelines for the matchday-1 fixtures, in the remote's CSV shape. */
function csvForMatchday(matchday: number, result = '2 - 1'): string {
  const header = 'Match Number,Round Number,Date,Location,Home Team,Away Team,Result';
  const rows = repo
    .getFixtures()
    .filter((fixture) => fixture.matchday === matchday)
    .map(
      (fixture) =>
        `${fixture.matchNumber},${fixture.matchday},16/08/2024 20:00,Stadium,Home,Away,${result}`,
    );
  return [header, ...rows].join('\n');
}

/** No network, no CSV rewrite, no snapshot — just the loop over the in-memory database. */
const offline = { skipRatings: true, skipExport: true, writeCsv: false, runs: 20 } as const;

describe('getDefaultSnapshotDir', () => {
  afterEach(() => {
    delete process.env.PUBLIC_SNAPSHOT_DIR;
  });

  it('writes into the checkout by default', () => {
    expect(getDefaultSnapshotDir().endsWith('/web/public/data')).toBe(true);
  });

  it('follows PUBLIC_SNAPSHOT_DIR when a container has no checkout to write back to', () => {
    process.env.PUBLIC_SNAPSHOT_DIR = '/app/export';
    expect(getDefaultSnapshotDir()).toBe('/app/export');
  });
});

describe('runWeek', () => {
  it('locks the weekend, projects the rest of the season and reports each step', async () => {
    const events: WeekRunEvent[] = [];
    const result = await runWeek(repo, {
      ...offline,
      csv: csvForMatchday(1),
      onEvent: (event) => events.push(event),
    });

    expect(result.results.applied).toBe(10);
    expect(result.ratings).toBeNull();
    expect(result.graded).toBeNull();
    expect(result.export).toBeNull();

    // Matchday 1 is banked, so the new batch projects from matchday 2.
    expect(result.projection.matchday).toBe(2);
    expect(result.projection.name).toMatch(/^MD2 · \d{4}-\d{2}-\d{2}$/);
    expect(result.projection.skipped).toBeNull();
    expect(result.projection.runs).toBe(20);
    expect(result.projection.teams).toHaveLength(20);

    const saved = repo.getPrediction(result.projection.predictionId!);
    expect(saved.name).toBe(result.projection.name);
    expect(saved.asOfMatchday).toBe(2);

    const steps = events.filter((event) => event.type === 'step');
    expect(steps.map((event) => event.step)).toEqual([
      'results',
      'ratings',
      'grading',
      'projection',
    ]);
    expect(steps.map((event) => event.index)).toEqual([1, 2, 3, 4]);
    expect(steps.every((event) => event.total === countWeekSteps(offline))).toBe(true);

    // Every step reports what it did, and the projection reports progress while it runs.
    expect(events.filter((event) => event.type === 'step-result')).toHaveLength(4);
    expect(events.some((event) => event.type === 'progress')).toBe(true);
  });

  it('grades the projection this weekend just settled', async () => {
    const first = await runWeek(repo, { ...offline, csv: csvForMatchday(1) });

    // Nothing to grade on the first run: the batch it saves predicts from matchday 2, and
    // matchday 2 has not been played.
    expect(first.graded).toBeNull();

    const second = await runWeek(repo, { ...offline, csv: csvForMatchday(2) });

    // The batch is chosen after the sync, so it is last week's — the one whose blind calls the
    // weekend just settled — and not the newer batch this run is about to save.
    expect(second.graded?.prediction.id).toBe(first.projection.predictionId);
    expect(second.graded?.accuracy.graded).toBe(10);
    expect(second.projection.predictionId).not.toBe(first.projection.predictionId);
  });

  it('refuses a remote correction to a recorded result unless forced', async () => {
    await runWeek(repo, { ...offline, csv: csvForMatchday(1, '2 - 1') });

    await expect(
      runWeek(repo, { ...offline, csv: csvForMatchday(1, '3 - 1') }),
    ).rejects.toBeInstanceOf(RemoteResultsChangedError);

    const first = repo.getFixtures().find((fixture) => fixture.matchday === 1)!;
    expect(repo.getActualResultsByMatch().get(first.matchNumber)).toEqual({
      goalsHome: 2,
      goalsAway: 1,
    });

    const forced = await runWeek(repo, {
      ...offline,
      csv: csvForMatchday(1, '3 - 1'),
      force: true,
    });
    expect(forced.results.overwritten).toBe(10);
    expect(repo.getActualResultsByMatch().get(first.matchNumber)).toEqual({
      goalsHome: 3,
      goalsAway: 1,
    });
  });

  it('writes nothing on a dry run', async () => {
    const result = await runWeek(repo, {
      ...offline,
      csv: csvForMatchday(1),
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.results.applied).toBe(10);
    expect(repo.getActualResultsByMatch().size).toBe(0);
    expect(result.projection.skipped).toBe('dry-run');
    expect(result.projection.predictionId).toBeUndefined();
    expect(repo.listPredictions(1, 10).total).toBe(0);
  });

  it('exports the public snapshot as the last step', async () => {
    const exportDir = await mkdtemp(join(tmpdir(), 'week-run-'));
    const result = await runWeek(repo, {
      ...offline,
      skipExport: false,
      csv: csvForMatchday(1),
      exportDir,
    });

    expect(result.export).toEqual({ dir: exportDir, revealPolicy: 'next-round' });
    const meta = JSON.parse(await readFile(join(exportDir, 'meta.json'), 'utf8')) as {
      predictionId: number;
    };
    expect(meta.predictionId).toBe(result.projection.predictionId);
  });

  it('projects nothing once every fixture is locked', async () => {
    for (const fixture of repo.getFixtures()) repo.setActualResult(fixture.matchNumber, 1, 0);

    const result = await runWeek(repo, { ...offline, csv: csvForMatchday(1, '') });

    expect(result.projection.matchday).toBeNull();
    expect(result.projection.skipped).toBe('season-complete');
    expect(result.projection.name).toMatch(/^Final · /);
  });
});
