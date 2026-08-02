import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Repository } from '../db/repository.js';
import { fetchPremierLeagueFixturesCsv, FIXTURES_CSV_URL } from './fetchFixtures.js';
import {
  getDefaultFixturesCsvPath,
  parseCompletedResultsFromCsv,
} from './fixturesCsv.js';

export interface SyncResultsSummary {
  applied: number;
  unchanged: number;
  overwritten: number;
  remoteCompleted: number;
  localActuals: number;
  dryRun: boolean;
  csvPath?: string;
}

export interface SyncResultsOptions {
  repo: Repository;
  /** Pre-fetched CSV body; when omitted, downloads from fixturedownload. */
  csv?: string;
  url?: string;
  dryRun?: boolean;
  /** When true (default), refresh data/fixtures.csv with the downloaded body. */
  writeCsv?: boolean;
  csvPath?: string;
}

export async function syncActualResultsFromRemote(
  options: SyncResultsOptions,
): Promise<SyncResultsSummary> {
  const {
    repo,
    dryRun = false,
    writeCsv = true,
    csvPath = getDefaultFixturesCsvPath(),
    url = FIXTURES_CSV_URL,
  } = options;

  const csv = options.csv ?? (await fetchPremierLeagueFixturesCsv(url));
  const remote = parseCompletedResultsFromCsv(csv);
  const local = repo.getActualResultsByMatch();

  let applied = 0;
  let unchanged = 0;
  let overwritten = 0;

  for (const result of remote) {
    if (!repo.getFixture(result.matchNumber)) {
      throw new Error(
        `Remote result for match ${result.matchNumber} has no matching fixture in the database. ` +
          'Re-fetch fixtures and reseed carefully before syncing results.',
      );
    }

    const existing = local.get(result.matchNumber);
    if (
      existing &&
      existing.goalsHome === result.goalsHome &&
      existing.goalsAway === result.goalsAway
    ) {
      unchanged += 1;
      continue;
    }

    if (existing) overwritten += 1;
    else applied += 1;

    if (!dryRun) {
      repo.setActualResult(result.matchNumber, result.goalsHome, result.goalsAway);
    }
  }

  let writtenPath: string | undefined;
  if (!dryRun && writeCsv) {
    mkdirSync(dirname(csvPath), { recursive: true });
    writeFileSync(csvPath, csv.endsWith('\n') ? csv : `${csv}\n`, 'utf8');
    writtenPath = csvPath;
  }

  return {
    applied,
    unchanged,
    overwritten,
    remoteCompleted: remote.length,
    localActuals: dryRun ? local.size : repo.getActualResults().length,
    dryRun,
    csvPath: writtenPath,
  };
}
