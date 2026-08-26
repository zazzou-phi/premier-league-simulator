import { beforeEach, describe, expect, it } from 'vitest';
import { backfillEloHistory } from '../src/data/backfillEloHistory.js';
import {
  ratingsFromRealResults,
  realResultsInOrder,
  syncTeamRatingsFromResults,
} from '../src/data/syncRatingsFromResults.js';
import type { Repository } from '../src/db/repository.js';
import { createTestRepository } from './testDb.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

/** Play a whole round. The test schedule spreads each one over two dates. */
function playRound(matchday: number, goalsHome = 2, goalsAway = 1): string[] {
  const fixtures = repo.getFixtures().filter((f) => f.matchday === matchday);
  for (const fixture of fixtures) {
    repo.setActualResult(fixture.matchNumber, goalsHome, goalsAway);
  }
  return [...new Set(fixtures.map((f) => f.date))].sort();
}

describe('realResultsInOrder', () => {
  it('replays chronologically, so a rearranged match lands where it was played', () => {
    playRound(1);
    const [first] = repo.getFixtures().filter((f) => f.matchday === 1);
    repo.updateFixtureSchedule(first!.matchNumber, { ...first!, date: '2027-03-09' });

    const order = realResultsInOrder(repo);
    // Moved to March, so it is now last — not first, where its round would have put it.
    expect(order.at(-1)!.matchNumber).toBe(first!.matchNumber);
    expect(order.map((r) => r.date)).toEqual([...order.map((r) => r.date)].sort());
  });

  it('breaks ties within a day by kickoff, then match number', () => {
    playRound(1);
    const sameDay = realResultsInOrder(repo).filter((r) => r.date === '2026-08-15');
    const keys = sameDay.map((r) => `${r.time}-${String(r.matchNumber).padStart(3, '0')}`);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('backfillEloHistory', () => {
  it('does nothing when no result has been recorded', () => {
    const summary = backfillEloHistory({ repo });
    expect(summary.points).toEqual([]);
    expect(summary.snapshots).toBe(0);
    expect(repo.getEloHistory()).toHaveLength(0);
  });

  it('writes one point per day played, not per round', () => {
    const round1 = playRound(1);
    const round2 = playRound(2);
    const summary = backfillEloHistory({ repo });

    expect(round1).toHaveLength(2);
    // An opening anchor point, then one per day football was played.
    expect(summary.points.map((p) => p.asOf)).toEqual(['2026-08-14', ...round1, ...round2]);
    expect(repo.getEloHistory()).toHaveLength(5 * 20);
  });

  it('opens the series on the anchors, the day before the first result', () => {
    playRound(1);
    const summary = backfillEloHistory({ repo });

    const opening = summary.points[0]!;
    expect(opening.matches).toBe(0);
    expect(opening.matchdays).toEqual([]);
    for (const snapshot of repo.getEloHistory().filter((s) => s.asOf === opening.asOf)) {
      const team = repo.getTeams().find((t) => t.id === snapshot.teamId)!;
      expect(snapshot.elo).toBeCloseTo(team.anchorElo ?? team.elo, 10);
    }
  });

  it('names the rounds each day covers', () => {
    playRound(1);
    const summary = backfillEloHistory({ repo });
    const played = summary.points.filter((p) => p.matches > 0);
    expect(played.every((p) => p.matchdays.length === 1 && p.matchdays[0] === 1)).toBe(true);
  });

  it('groups a rearranged match with the day it was actually played', () => {
    playRound(1);
    playRound(2);
    const [moved] = repo.getFixtures().filter((f) => f.matchday === 1);
    // Played late, on a day round 2 was already using.
    repo.updateFixtureSchedule(moved!.matchNumber, { ...moved!, date: '2026-08-23' });

    const summary = backfillEloHistory({ repo });
    const shared = summary.points.find((p) => p.asOf === '2026-08-23')!;
    expect(shared.matches).toBeGreaterThan(0);
    expect(shared.matchdays).toEqual([1, 2]);
    expect(summary.points.some((p) => p.matchdays.includes(1) && p.asOf === '2026-08-23')).toBe(true);
  });

  it('ends on exactly the rating the live sync produces', () => {
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

  it('is idempotent — re-running rewrites the same rows', () => {
    playRound(1);
    playRound(2);
    backfillEloHistory({ repo });
    const first = repo.getEloHistory().map((s) => `${s.teamId}@${s.asOf}=${s.elo}`);

    backfillEloHistory({ repo });
    backfillEloHistory({ repo });

    expect(repo.getEloHistory().map((s) => `${s.teamId}@${s.asOf}=${s.elo}`)).toEqual(first);
  });

  it('fills days the weekly loop was never run for', async () => {
    playRound(1);
    await syncTeamRatingsFromResults({ repo, writeCsv: false });
    expect(repo.getEloHistoryDates()).toHaveLength(1);

    // Rounds 2 and 3 happen, but nobody runs the loop until after round 3.
    playRound(2);
    playRound(3);
    await syncTeamRatingsFromResults({ repo, writeCsv: false });
    expect(repo.getEloHistoryDates()).toHaveLength(2);

    backfillEloHistory({ repo });
    // Three rounds over two days each, plus the opening anchor point.
    expect(repo.getEloHistoryDates()).toHaveLength(7);
  });

  it('writes nothing on a dry run but reports what it would do', () => {
    const days = playRound(1);
    const summary = backfillEloHistory({ repo, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.points).toHaveLength(days.length + 1);
    expect(summary.snapshots).toBe((days.length + 1) * 20);
    expect(repo.getEloHistory()).toHaveLength(0);
  });

  it('dates a partly played round by the days actually played', () => {
    const fixtures = repo.getFixtures().filter((f) => f.matchday === 1);
    const [early] = [...fixtures].sort((a, b) => a.date.localeCompare(b.date));
    repo.setActualResult(early!.matchNumber, 1, 0);

    const summary = backfillEloHistory({ repo });
    const played = summary.points.filter((p) => p.matches > 0);
    expect(played).toHaveLength(1);
    expect(played[0]!.matches).toBe(1);
    expect(played[0]!.asOf).toBe(early!.date);
  });
});
