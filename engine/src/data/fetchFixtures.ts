import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDefaultFixturesCsvPath } from './fixturesCsv.js';

/** UK wall-clock kickoffs from fixturedownload.com (DST-aware despite the GMT label). */
export const FIXTURES_CSV_URL =
  'https://fixturedownload.com/download/epl-2026-GMTStandardTime.csv';

export async function fetchPremierLeagueFixturesCsv(url = FIXTURES_CSV_URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download fixtures (${response.status}): ${url}`);
  }
  const text = await response.text();
  if (!text.includes('Home Team') || !text.includes('Away Team')) {
    throw new Error('Downloaded fixtures CSV is missing expected columns');
  }
  return text;
}

export async function fetchAndWriteFixtures(
  outPath = getDefaultFixturesCsvPath(),
  url = FIXTURES_CSV_URL,
): Promise<{ path: string; matches: number }> {
  const csv = await fetchPremierLeagueFixturesCsv(url);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, csv.endsWith('\n') ? csv : `${csv}\n`, 'utf8');
  const matches = csv.trim().split(/\r?\n/).length - 1;
  return { path: outPath, matches };
}
