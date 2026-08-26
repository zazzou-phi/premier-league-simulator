import { beforeEach, describe, expect, it } from 'vitest';
import { syncFixturesFromRemote } from '../src/data/syncFixtures.js';
import { backfillEloHistory } from '../src/data/backfillEloHistory.js';
import { FIXTURE_TEAM_ALIASES } from '../src/data/fixturesCsv.js';
import type { Repository } from '../src/db/repository.js';
import { createTestRepository } from './testDb.js';

/**
 * fixturedownload's own club names, and the canonical names they resolve to.
 *
 * The parser takes a strict allowlist rather than passing unknown names through, so the CSV a
 * test builds has to use real names — synthetic "Club 01" would be rejected before any of the
 * reconciliation logic ran.
 */
const CSV_NAMES = Object.keys(FIXTURE_TEAM_ALIASES);

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
  // Rename the synthetic clubs to the canonical names the aliases map to, keeping ids fixed.
  const sqlite = (repo as unknown as { sqlite: import('better-sqlite3').Database }).sqlite;
  const rename = sqlite.prepare('UPDATE teams SET name = ? WHERE id = ?');
  CSV_NAMES.forEach((csvName, index) => {
    rename.run(FIXTURE_TEAM_ALIASES[csvName], index + 1);
  });
});

/**
 * The stored fixture list, rendered back into fixturedownload's CSV shape so it round-trips
 * through the same parser the real download uses.
 */
function csvFromStored(
  overrides: Record<number, { date?: string; time?: string; matchday?: number; swap?: boolean }> = {},
): string {
  // Ids were assigned in alias order above, so index back to the CSV spelling.
  const names = new Map(repo.getTeams().map((team) => [team.id, CSV_NAMES[team.id - 1]!]));
  const header = 'Match Number,Round Number,Date,Location,Home Team,Away Team,Result';
  const rows = repo.getFixtures().map((fixture) => {
    const override = overrides[fixture.matchNumber] ?? {};
    const [y, m, d] = (override.date ?? fixture.date).split('-');
    const time = override.time ?? fixture.time;
    const home = override.swap ? fixture.teamAwayId : fixture.teamHomeId;
    const away = override.swap ? fixture.teamHomeId : fixture.teamAwayId;
    return [
      fixture.matchNumber,
      override.matchday ?? fixture.matchday,
      `${d}/${m}/${y} ${time}`,
      'Stadium',
      names.get(home),
      names.get(away),
      '',
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

const sync = (csv: string, dryRun = false) =>
  syncFixturesFromRemote({ repo, csv, writeCsv: false, dryRun });

describe('syncFixturesFromRemote', () => {
  it('reports nothing to do when the calendar already matches', async () => {
    const summary = await sync(csvFromStored());
    expect(summary.moved).toEqual([]);
    expect(summary.unchanged).toBe(380);
    expect(summary.mismatched).toEqual([]);
  });

  it('applies a rearranged kickoff', async () => {
    const before = repo.getFixture(15)!;
    const summary = await sync(csvFromStored({ 15: { date: '2027-01-19', time: '19:45' } }));

    expect(summary.moved).toHaveLength(1);
    expect(summary.moved[0]).toMatchObject({
      matchNumber: 15,
      from: { date: before.date, time: before.time },
      to: { date: '2027-01-19', time: '19:45' },
      roundChanged: false,
      played: false,
    });

    const after = repo.getFixture(15)!;
    expect(after.date).toBe('2027-01-19');
    expect(after.time).toBe('19:45');
    // Who is playing never moves with the calendar.
    expect(after.teamHomeId).toBe(before.teamHomeId);
    expect(after.teamAwayId).toBe(before.teamAwayId);
  });

  it('flags a fixture that has already been played', async () => {
    repo.setActualResult(15, 2, 1);
    const summary = await sync(csvFromStored({ 15: { date: '2027-01-19' } }));
    expect(summary.moved[0]!.played).toBe(true);
    // The result itself is untouched by a calendar move.
    expect(repo.getActualResultsByMatch().get(15)).toEqual({ goalsHome: 2, goalsAway: 1 });
  });

  it('notes when the round changed, not just the kickoff', async () => {
    const summary = await sync(csvFromStored({ 15: { matchday: 30, date: '2027-03-06' } }));
    expect(summary.moved[0]!.roundChanged).toBe(true);
    expect(repo.getFixture(15)!.matchday).toBe(30);
  });

  it('refuses to apply a changed pairing, and reports it', async () => {
    // Two fixtures trade teams. A single swap would unbalance home/away counts and be thrown
    // out by the parser's own validation; this passes it, so the reconciliation has to be the
    // thing that catches it.
    const [a, b] = [repo.getFixture(15)!, repo.getFixture(16)!];
    const names = new Map(repo.getTeams().map((t) => [t.id, CSV_NAMES[t.id - 1]!]));
    const csv = csvFromStored()
      .split('\n')
      .map((line) => {
        const cells = line.split(',');
        if (cells[0] === '15') {
          cells[4] = names.get(b.teamHomeId)!;
          cells[5] = names.get(b.teamAwayId)!;
        } else if (cells[0] === '16') {
          cells[4] = names.get(a.teamHomeId)!;
          cells[5] = names.get(a.teamAwayId)!;
        }
        return cells.join(',');
      })
      .join('\n');

    const summary = await sync(csv);

    expect(summary.moved).toEqual([]);
    expect(summary.mismatched.map((m) => m.matchNumber)).toEqual([15, 16]);

    // Neither pairing moved, because the match number is what everything else keys off.
    expect(repo.getFixture(15)!.teamHomeId).toBe(a.teamHomeId);
    expect(repo.getFixture(16)!.teamHomeId).toBe(b.teamHomeId);
  });

  it('changes nothing on a dry run', async () => {
    const before = repo.getFixture(15)!;
    const summary = await sync(csvFromStored({ 15: { date: '2027-01-19' } }), true);

    expect(summary.dryRun).toBe(true);
    expect(summary.moved).toHaveLength(1);
    expect(repo.getFixture(15)!.date).toBe(before.date);
  });

  it('rejects a truncated download rather than half-applying it', async () => {
    const full = csvFromStored().split('\n');
    const truncated = [full[0]!, ...full.slice(1, 100)].join('\n');
    await expect(sync(truncated)).rejects.toThrow(/380/);
  });
});

describe('rescheduling and Elo history together', () => {
  it('re-dates the round and prunes the point the round no longer ends on', async () => {
    // Round 1 is played and recorded under its original closing date.
    const round1 = repo.getFixtures().filter((f) => f.matchday === 1);
    for (const fixture of round1) repo.setActualResult(fixture.matchNumber, 2, 1);
    backfillEloHistory({ repo });

    const originalDate = round1.reduce((a, f) => (f.date > a ? f.date : a), round1[0]!.date);
    expect(repo.getEloHistoryDates()).toEqual([originalDate]);

    // One of them turns out to have been played later than the calendar said.
    const late = '2026-12-15';
    await sync(csvFromStored({ [round1[0]!.matchNumber]: { date: late } }));
    const rebuilt = backfillEloHistory({ repo, prune: true });

    // The round now closes on the later date, and the old point is gone rather than lingering
    // as a rating for a day no round ended on.
    expect(rebuilt.rounds[0]!.asOf).toBe(late);
    expect(repo.getEloHistoryDates()).toEqual([late]);
    expect(rebuilt.pruned).toBe(1);
  });

  it('leaves the pre-season baseline alone when pruning', () => {
    repo.recordEloSnapshot('2026-08-01', repo.getTeams().map((t) => ({ teamId: t.id, elo: t.elo })));
    for (const fixture of repo.getFixtures().filter((f) => f.matchday === 1)) {
      repo.setActualResult(fixture.matchNumber, 1, 0);
    }

    backfillEloHistory({ repo, prune: true });
    // Pruning is scoped to the first round onward, so the baseline survives.
    expect(repo.getEloHistoryDates()).toContain('2026-08-01');
  });

  it('counts stored rows rather than rows attempted when two rounds share a date', () => {
    for (const md of [1, 2]) {
      for (const fixture of repo.getFixtures().filter((f) => f.matchday === md)) {
        repo.setActualResult(fixture.matchNumber, 2, 1);
      }
    }
    const round2 = repo.getFixtures().filter((f) => f.matchday === 2);
    const shared = round2.reduce((a, f) => (f.date > a ? f.date : a), round2[0]!.date);
    for (const fixture of repo.getFixtures().filter((f) => f.matchday === 1)) {
      repo.updateFixtureSchedule(fixture.matchNumber, { ...fixture, date: shared });
    }

    const summary = backfillEloHistory({ repo });
    expect(summary.rounds).toHaveLength(2);
    expect(repo.getEloHistoryDates()).toEqual([shared]);
    expect(summary.snapshots).toBe(repo.getEloHistory().length);
  });
});
