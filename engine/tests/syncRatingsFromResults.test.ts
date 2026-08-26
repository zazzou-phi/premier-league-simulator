import { beforeEach, describe, expect, it } from 'vitest';
import {
  ratingsFromRealResults,
  syncTeamRatingsFromResults,
} from '../src/data/syncRatingsFromResults.js';
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

const sync = (dryRun = false) => syncTeamRatingsFromResults({ repo, writeCsv: false, dryRun });

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
