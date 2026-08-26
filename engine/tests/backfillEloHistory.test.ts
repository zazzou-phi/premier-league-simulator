import { beforeEach, describe, expect, it } from 'vitest';
import { backfillEloHistory } from '../src/data/backfillEloHistory.js';
import {
  ratingsFromRealResults,
  syncTeamRatingsFromResults,
} from '../src/data/syncRatingsFromResults.js';
import type { Repository } from '../src/db/repository.js';
import { createTestRepository } from './testDb.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

/** Play a whole round, so each backfilled point covers a complete matchday. */
function playRound(matchday: number, goalsHome = 2, goalsAway = 1): string {
  const fixtures = repo.getFixtures().filter((f) => f.matchday === matchday);
  for (const fixture of fixtures) {
    repo.setActualResult(fixture.matchNumber, goalsHome, goalsAway);
  }
  return fixtures.reduce((latest, f) => (f.date > latest ? f.date : latest), fixtures[0]!.date);
}

describe('backfillEloHistory', () => {
  it('does nothing when no result has been recorded', () => {
    const summary = backfillEloHistory({ repo });
    expect(summary.rounds).toEqual([]);
    expect(summary.snapshots).toBe(0);
    expect(repo.getEloHistory()).toHaveLength(0);
  });

  it('writes one point per round, dated by that round rather than by today', () => {
    const first = playRound(1);
    const second = playRound(2);
    const summary = backfillEloHistory({ repo });

    expect(summary.rounds.map((r) => r.matchday)).toEqual([1, 2]);
    expect(summary.rounds.map((r) => r.asOf)).toEqual([first, second]);
    expect(summary.rounds.every((r) => r.matches === 10)).toBe(true);
    expect(repo.getEloHistory()).toHaveLength(40);
  });

  it('ends on exactly the rating the live sync produces', async () => {
    playRound(1);
    playRound(2);
    playRound(3);
    backfillEloHistory({ repo });

    // The last backfilled point and the current rating are two routes to the same number;
    // if they can disagree, the chart is telling a different story from the table.
    const live = ratingsFromRealResults(repo);
    const lastDate = repo.getEloHistoryDates()[0]!;
    for (const snapshot of repo.getEloHistory().filter((s) => s.asOf === lastDate)) {
      expect(snapshot.elo).toBeCloseTo(live.get(snapshot.teamId)!, 10);
    }
  });

  it('agrees with running the weekly sync round by round', async () => {
    // Same three rounds, revealed one at a time, is what the loop would have recorded had it
    // been run every week. The backfill has to reproduce it from a standing start.
    playRound(1);
    await syncTeamRatingsFromResults({ repo, writeCsv: false });
    playRound(2);
    await syncTeamRatingsFromResults({ repo, writeCsv: false });
    playRound(3);
    await syncTeamRatingsFromResults({ repo, writeCsv: false });
    const incremental = repo.getEloHistory().map((s) => `${s.teamId}@${s.asOf}=${s.elo.toFixed(6)}`);

    const { repo: rebuilt } = createTestRepository();
    for (const md of [1, 2, 3]) {
      for (const fixture of rebuilt.getFixtures().filter((f) => f.matchday === md)) {
        rebuilt.setActualResult(fixture.matchNumber, 2, 1);
      }
    }
    backfillEloHistory({ repo: rebuilt });

    expect(rebuilt.getEloHistory().map((s) => `${s.teamId}@${s.asOf}=${s.elo.toFixed(6)}`)).toEqual(
      incremental,
    );
  });

  it('is idempotent — re-running rewrites the same rows', () => {
    playRound(1);
    playRound(2);
    backfillEloHistory({ repo });
    const first = repo.getEloHistory().map((s) => `${s.teamId}@${s.asOf}=${s.elo}`);

    backfillEloHistory({ repo });
    backfillEloHistory({ repo });

    expect(repo.getEloHistory()).toHaveLength(40);
    expect(repo.getEloHistory().map((s) => `${s.teamId}@${s.asOf}=${s.elo}`)).toEqual(first);
  });

  it('fills a round that the weekly loop was never run for', async () => {
    playRound(1);
    await syncTeamRatingsFromResults({ repo, writeCsv: false });

    // Round 2 happens, but nobody runs the loop until round 3 — so the live sync records only
    // the latest, leaving a hole the backfill can close.
    playRound(2);
    playRound(3);
    await syncTeamRatingsFromResults({ repo, writeCsv: false });
    expect(repo.getEloHistoryDates()).toHaveLength(2);

    backfillEloHistory({ repo });
    expect(repo.getEloHistoryDates()).toHaveLength(3);
  });

  it('writes nothing on a dry run but reports what it would do', () => {
    playRound(1);
    const summary = backfillEloHistory({ repo, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.snapshots).toBe(20);
    expect(summary.rounds).toHaveLength(1);
    expect(repo.getEloHistory()).toHaveLength(0);
  });

  it('dates a partly played round by its last result so far', () => {
    const fixtures = repo.getFixtures().filter((f) => f.matchday === 1);
    const [early] = [...fixtures].sort((a, b) => a.date.localeCompare(b.date));
    repo.setActualResult(early!.matchNumber, 1, 0);

    const summary = backfillEloHistory({ repo });
    expect(summary.rounds).toHaveLength(1);
    expect(summary.rounds[0]!.matches).toBe(1);
    expect(summary.rounds[0]!.asOf).toBe(early!.date);
  });
});
