/**
 * Reconciles the stored fixture calendar with the remote one, so postponements land.
 *
 * `seed` was the only thing that had ever written the `fixtures` table, and nothing updated it
 * afterwards. `fetch:results` refreshed `data/fixtures.csv` on disk but left the database
 * holding whatever dates were true on the day the season was seeded, so a rearranged match kept
 * its original date indefinitely — and the only way to reconcile was `seed --force`, which
 * clears results, predictions, simulations and Elo history along with it.
 *
 * Only the schedule moves. Match number to team pairing is the identity every other table keys
 * off, so a remote reporting a different pairing for a match number is reported as a mismatch
 * and changes nothing.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repository } from '../db/repository.js';
import type { Fixture } from '../engine/types.js';
import { fetchPremierLeagueFixturesCsv, FIXTURES_CSV_URL } from './fetchFixtures.js';
import { getDefaultFixturesCsvPath, parseFixturesCsv } from './fixturesCsv.js';

export interface FixtureMove {
  matchNumber: number;
  homeName: string;
  awayName: string;
  from: { matchday: number; date: string; time: string };
  to: { matchday: number; date: string; time: string };
  /** True when the round changed, not just the kickoff. */
  roundChanged: boolean;
  /** True when a result is already recorded, so the move is retrospective. */
  played: boolean;
}

export interface FixtureMismatch {
  matchNumber: number;
  stored: string;
  remote: string;
}

export interface SyncFixturesSummary {
  moved: FixtureMove[];
  unchanged: number;
  /** Match numbers whose teams disagree; never applied. */
  mismatched: FixtureMismatch[];
  dryRun: boolean;
  csvPath?: string;
}

export interface SyncFixturesOptions {
  repo: Repository;
  /** Pre-fetched CSV body; when omitted, downloads from fixturedownload. */
  csv?: string;
  url?: string;
  dryRun?: boolean;
  /** When true (default), refresh data/fixtures.csv with the downloaded body. */
  writeCsv?: boolean;
  csvPath?: string;
}

const sameSchedule = (a: Fixture, b: Fixture) =>
  a.matchday === b.matchday && a.date === b.date && a.time === b.time;

export async function syncFixturesFromRemote(
  options: SyncFixturesOptions,
): Promise<SyncFixturesSummary> {
  const {
    repo,
    dryRun = false,
    writeCsv = true,
    csvPath = getDefaultFixturesCsvPath(),
    url = FIXTURES_CSV_URL,
  } = options;

  const csv = options.csv ?? (await fetchPremierLeagueFixturesCsv(url));
  const teams = repo.getTeams();

  // parseFixturesCsv validates the whole list — 380 fixtures, unique match numbers, 19 home and
  // 19 away per club — so a truncated or garbled download is rejected before anything is written.
  const remote = parseFixturesCsv(csv, teams);

  const stored = new Map(repo.getFixtures().map((fixture) => [fixture.matchNumber, fixture]));
  const teamName = new Map(teams.map((team) => [team.id, team.shortName]));
  const played = repo.getActualResultsByMatch();

  const moved: FixtureMove[] = [];
  const mismatched: FixtureMismatch[] = [];
  let unchanged = 0;

  for (const fixture of remote) {
    const current = stored.get(fixture.matchNumber);
    if (!current) continue;

    if (
      current.teamHomeId !== fixture.teamHomeId ||
      current.teamAwayId !== fixture.teamAwayId
    ) {
      mismatched.push({
        matchNumber: fixture.matchNumber,
        stored: `${teamName.get(current.teamHomeId)} v ${teamName.get(current.teamAwayId)}`,
        remote: `${teamName.get(fixture.teamHomeId)} v ${teamName.get(fixture.teamAwayId)}`,
      });
      continue;
    }

    if (sameSchedule(current, fixture)) {
      unchanged += 1;
      continue;
    }

    moved.push({
      matchNumber: fixture.matchNumber,
      homeName: teamName.get(current.teamHomeId) ?? String(current.teamHomeId),
      awayName: teamName.get(current.teamAwayId) ?? String(current.teamAwayId),
      from: { matchday: current.matchday, date: current.date, time: current.time },
      to: { matchday: fixture.matchday, date: fixture.date, time: fixture.time },
      roundChanged: current.matchday !== fixture.matchday,
      played: played.has(fixture.matchNumber),
    });
  }

  let writtenPath: string | undefined;
  if (!dryRun) {
    for (const move of moved) {
      repo.updateFixtureSchedule(move.matchNumber, move.to);
    }

    if (writeCsv) {
      await mkdir(dirname(csvPath), { recursive: true });
      await writeFile(csvPath, csv.endsWith('\n') ? csv : `${csv}\n`, 'utf8');
      writtenPath = csvPath;
    }
  }

  return { moved, unchanged, mismatched, dryRun, csvPath: writtenPath };
}
