import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ratingsFromRealResults,
  syncTeamRatingsFromResults,
} from '../src/data/syncRatingsFromResults.js';
import { getDefaultTeamsCsvPath } from '../src/data/teamsCsv.js';
import { matchEloDelta } from '../src/engine/seasonElo.js';
import type { Repository } from '../src/db/repository.js';
import { createTestRepository } from './testDb.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

/** Record a result on the given fixture, returning the clubs involved. */
function play(matchNumber: number, goalsHome: number, goalsAway: number) {
  const fixture = repo.getFixture(matchNumber)!;
  repo.setActualResult(matchNumber, goalsHome, goalsAway);
  return fixture;
}

const sync = (dryRun = false) => syncTeamRatingsFromResults({ repo, dryRun });

describe('ratingsFromRealResults', () => {
  it('leaves every rating alone when nothing has been played', () => {
    const before = new Map(repo.getTeams().map((t) => [t.id, t.elo]));
    for (const [id, elo] of ratingsFromRealResults(repo)) {
      expect(elo).toBeCloseTo(before.get(id)!, 12);
    }
  });

  it('moves the winner up and the loser down by the same amount', () => {
    const fixture = play(1, 3, 0);
    const before = new Map(repo.getTeams().map((t) => [t.id, t.elo]));
    const after = ratingsFromRealResults(repo);

    const homeMove = after.get(fixture.teamHomeId)! - before.get(fixture.teamHomeId)!;
    const awayMove = after.get(fixture.teamAwayId)! - before.get(fixture.teamAwayId)!;

    expect(homeMove).toBeGreaterThan(0);
    expect(awayMove).toBeLessThan(0);
    expect(homeMove + awayMove).toBeCloseTo(0, 10);
  });

  it('stays zero-sum across the league', () => {
    play(1, 2, 0);
    play(2, 1, 1);
    play(3, 0, 4);

    const before = repo.getTeams().reduce((sum, t) => sum + t.elo, 0);
    const after = [...ratingsFromRealResults(repo).values()].reduce((sum, e) => sum + e, 0);
    expect(after).toBeCloseTo(before, 8);
  });

  it('agrees with a hand-computed Elo update on a single result', () => {
    const fixture = play(1, 1, 0);
    const teams = new Map(repo.getTeams().map((t) => [t.id, t]));
    const home = teams.get(fixture.teamHomeId)!;
    const away = teams.get(fixture.teamAwayId)!;

    const [expectedHome] = matchEloDelta(home.elo, away.elo, 1, 0);
    const after = ratingsFromRealResults(repo);
    expect(after.get(home.id)! - home.elo).toBeCloseTo(expectedHome, 10);
  });
});

describe('syncTeamRatingsFromResults', () => {
  it('leaves teams.csv alone, so the anchors survive the season', async () => {
    // teams.csv is the pre-season anchor set a rebuilt database replays the results from.
    // Writing the drifted rating back would destroy the only copy of what it drifted from,
    // and the next sync would then anchor on the drifted number and double-count every result.
    const before = readFileSync(getDefaultTeamsCsvPath(), 'utf8');

    play(1, 3, 0);
    const summary = await sync();

    expect(summary.updated).toBeGreaterThan(0);
    expect(readFileSync(getDefaultTeamsCsvPath(), 'utf8')).toBe(before);
    expect(summary.csvPath).toBeUndefined();
  });

  it('writes the recomputed ratings and dates a snapshot', async () => {
    const fixture = play(1, 3, 0);
    const summary = await sync();

    expect(summary.updated).toBeGreaterThan(0);
    expect(summary.snapshotted).toBe(20);
    expect(summary.dryRun).toBe(false);

    const home = repo.getTeams().find((t) => t.id === fixture.teamHomeId)!;
    expect(home.elo).toBeGreaterThan(home.anchorElo!);
  });

  it('is idempotent — a second run changes nothing', async () => {
    play(1, 3, 0);
    play(2, 0, 2);
    await sync();

    const afterFirst = new Map(repo.getTeams().map((t) => [t.id, t.elo]));
    const second = await sync();

    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(20);
    for (const team of repo.getTeams()) {
      expect(team.elo).toBeCloseTo(afterFirst.get(team.id)!, 12);
    }
  });

  it('recomputes from the anchor rather than compounding on the last result', async () => {
    play(1, 3, 0);
    await sync();
    const afterOne = new Map(repo.getTeams().map((t) => [t.id, t.elo]));

    // Running five more times must not move anything further, which is the whole point of
    // rebuilding from the anchor instead of incrementing the current rating.
    for (let i = 0; i < 5; i++) await sync();

    for (const team of repo.getTeams()) {
      expect(team.elo).toBeCloseTo(afterOne.get(team.id)!, 12);
    }
  });

  it('pins the anchor once and never moves it again', async () => {
    const before = new Map(repo.getTeams().map((t) => [t.id, t.elo]));
    play(1, 4, 0);
    await sync();
    await sync();

    for (const team of repo.getTeams()) {
      expect(team.anchorElo).toBeCloseTo(before.get(team.id)!, 12);
    }
  });

  it('absorbs a corrected scoreline instead of layering it on the wrong one', async () => {
    play(1, 3, 0);
    await sync();

    // Same fixture, corrected the other way. The rating must end up where it would have been
    // had the corrected score been the only one ever recorded.
    play(1, 0, 3);
    await sync();
    const corrected = new Map(repo.getTeams().map((t) => [t.id, t.elo]));

    const { repo: fresh } = createTestRepository();
    fresh.setActualResult(1, 0, 3);
    const direct = ratingsFromRealResults(fresh);

    for (const [id, elo] of direct) {
      expect(corrected.get(id)!).toBeCloseTo(elo, 10);
    }
  });

  it('dates the snapshot by the last result, not the day it ran', async () => {
    const fixture = play(1, 2, 0);
    const summary = await syncTeamRatingsFromResults({
      repo,
      writeCsv: false,
      date: new Date('2030-01-01T12:00:00Z'),
    });

    expect(summary.asOf).toBe(fixture.date);
    expect(repo.getEloHistoryDates()).toEqual([fixture.date]);
  });

  it('records nothing when no match has been played', async () => {
    const summary = await sync();
    expect(summary.snapshotted).toBeUndefined();
    expect(repo.getEloHistory()).toHaveLength(0);
  });

  it('adds no snapshot on an idle run, however often it is called', async () => {
    play(1, 2, 0);
    await sync();
    expect(repo.getEloHistory()).toHaveLength(20);

    // A rating only moves when a match is played, so a quiet week must add no points — three
    // identical snapshots would also hide the last real move, which `groupEloSeries` reports
    // as the difference between the final two.
    for (let i = 0; i < 3; i++) {
      const idle = await syncTeamRatingsFromResults({
        repo,
        writeCsv: false,
        date: new Date(`2026-09-0${i + 1}T12:00:00Z`),
      });
      expect(idle.snapshotted).toBeUndefined();
    }

    expect(repo.getEloHistory()).toHaveLength(20);
    expect(repo.getEloHistoryDates()).toHaveLength(1);
  });

  it('adds one point per round as results come in', async () => {
    const first = play(1, 2, 0);
    await sync();

    const second = repo.getFixture(11)!;
    play(11, 0, 3);
    await sync();

    expect(repo.getEloHistoryDates().sort()).toEqual([first.date, second.date].sort());
    expect(repo.getEloHistory()).toHaveLength(40);
  });

  it('revises the snapshot in place when a scoreline is corrected', async () => {
    const fixture = play(1, 3, 0);
    await sync();
    const optimistic = repo.getEloHistory(fixture.teamHomeId).at(-1)!.elo;

    play(1, 0, 3);
    await sync();
    const corrected = repo.getEloHistory(fixture.teamHomeId);

    // Same date, one row, revised value — not a second point implying the club moved twice.
    expect(corrected).toHaveLength(1);
    expect(corrected[0]!.asOf).toBe(fixture.date);
    expect(corrected[0]!.elo).toBeLessThan(optimistic);
  });

  it('writes nothing on a dry run but still reports the movers', async () => {
    play(1, 5, 0);
    const before = new Map(repo.getTeams().map((t) => [t.id, t.elo]));
    const summary = await sync(true);

    expect(summary.dryRun).toBe(true);
    expect(summary.snapshotted).toBeUndefined();
    expect(summary.movers!.length).toBeGreaterThan(0);
    for (const team of repo.getTeams()) {
      expect(team.elo).toBeCloseTo(before.get(team.id)!, 12);
    }
    expect(repo.getEloHistory()).toHaveLength(0);
  });
});
