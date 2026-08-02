import { beforeEach, describe, expect, it } from 'vitest';
import { syncActualResultsFromRemote } from '../src/data/syncResults.js';
import type { Repository } from '../src/db/repository.js';
import { createTestRepository } from './testDb.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

function csvWithResults(
  rows: Array<{ matchNumber: number; result?: string }>,
): string {
  const header = 'Match Number,Round Number,Date,Location,Home Team,Away Team,Result';
  const body = rows.map(
    ({ matchNumber, result = '' }) =>
      `${matchNumber},1,16/08/2024 20:00,Stadium,Home,Away,${result}`,
  );
  return [header, ...body].join('\n');
}

describe('syncActualResultsFromRemote', () => {
  it('locks new completed scores from the CSV', async () => {
    const summary = await syncActualResultsFromRemote({
      repo,
      csv: csvWithResults([
        { matchNumber: 1, result: '2 - 1' },
        { matchNumber: 2, result: '0 - 0' },
        { matchNumber: 3 },
      ]),
      writeCsv: false,
    });

    expect(summary).toMatchObject({
      applied: 2,
      unchanged: 0,
      overwritten: 0,
      remoteCompleted: 2,
      localActuals: 2,
      dryRun: false,
    });
    expect(repo.getActualResultsByMatch().get(1)).toEqual({ goalsHome: 2, goalsAway: 1 });
    expect(repo.getActualResultsByMatch().get(2)).toEqual({ goalsHome: 0, goalsAway: 0 });
    expect(repo.getActualResultsByMatch().has(3)).toBe(false);
  });

  it('skips unchanged scores and overwrites corrections', async () => {
    repo.setActualResult(1, 2, 1);
    repo.setActualResult(2, 1, 0);

    const summary = await syncActualResultsFromRemote({
      repo,
      csv: csvWithResults([
        { matchNumber: 1, result: '2 - 1' },
        { matchNumber: 2, result: '1 - 1' },
      ]),
      writeCsv: false,
    });

    expect(summary).toMatchObject({
      applied: 0,
      unchanged: 1,
      overwritten: 1,
      remoteCompleted: 2,
      localActuals: 2,
    });
    expect(repo.getActualResultsByMatch().get(2)).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('does not unlock blanks that are already recorded locally', async () => {
    repo.setActualResult(1, 3, 0);

    await syncActualResultsFromRemote({
      repo,
      csv: csvWithResults([{ matchNumber: 1 }, { matchNumber: 2, result: '1 - 0' }]),
      writeCsv: false,
    });

    expect(repo.getActualResultsByMatch().get(1)).toEqual({ goalsHome: 3, goalsAway: 0 });
    expect(repo.getActualResultsByMatch().get(2)).toEqual({ goalsHome: 1, goalsAway: 0 });
  });

  it('dry-run reports diffs without writing', async () => {
    const summary = await syncActualResultsFromRemote({
      repo,
      csv: csvWithResults([{ matchNumber: 1, result: '1 - 0' }]),
      dryRun: true,
      writeCsv: false,
    });

    expect(summary).toMatchObject({
      applied: 1,
      unchanged: 0,
      overwritten: 0,
      localActuals: 0,
      dryRun: true,
    });
    expect(repo.getActualResults()).toHaveLength(0);
  });

  it('fails loudly when a remote match number is missing from the DB', async () => {
    await expect(
      syncActualResultsFromRemote({
        repo,
        csv: csvWithResults([{ matchNumber: 9999, result: '1 - 0' }]),
        writeCsv: false,
      }),
    ).rejects.toThrow(/no matching fixture/);
  });
});
