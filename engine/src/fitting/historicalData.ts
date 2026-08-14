/**
 * Historical training data for parameter fitting: completed seasons from fixturedownload
 * joined to point-in-time Elo from clubelo.
 *
 * Both sources are cached on disk. Fitting is re-run often while tuning, and neither source
 * should be hammered for data that cannot change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { CLUBELO_BASE_URL } from '../data/fetchRatings.js';

/** A season is named for the calendar year it starts in: 2023 is 2023/24. */
export type SeasonYear = number;

export interface HistoricalMatch {
  season: SeasonYear;
  matchday: number;
  /** Kickoff date as `YYYY-MM-DD`. */
  date: string;
  homeClub: string;
  awayClub: string;
  goalsHome: number;
  goalsAway: number;
}

export interface EloInterval {
  /** Inclusive `YYYY-MM-DD` start of the window this rating was current for. */
  from: string;
  /** Inclusive `YYYY-MM-DD` end of the window. */
  to: string;
  elo: number;
}

export type EloHistory = Map<string, EloInterval[]>;

/**
 * fixturedownload's team names differ from clubelo's for a handful of clubs, and it has used
 * more than one spelling for Forest across seasons. Everything else matches clubelo exactly.
 */
export const FIXTURE_CLUB_ALIASES: Record<string, string> = {
  'Man Utd': 'Man United',
  Spurs: 'Tottenham',
  "Nott'm Forest": 'Forest',
  'Nottingham Forest': 'Forest',
  'Sheffield Utd': 'Sheffield United',
};

export function toClubEloName(fixtureName: string): string {
  return FIXTURE_CLUB_ALIASES[fixtureName] ?? fixtureName;
}

export function seasonCsvUrl(season: SeasonYear): string {
  return `https://fixturedownload.com/download/epl-${season}-GMTStandardTime.csv`;
}

/** clubelo's per-club endpoint wants the club name with spaces removed, not percent-encoded. */
export function clubEloHistoryUrl(club: string): string {
  return `${CLUBELO_BASE_URL}/${club.replace(/\s+/g, '')}`;
}

function defaultCacheDir(): string {
  return join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), '.cache', 'fitting');
}

async function cachedFetch(url: string, cachePath: string): Promise<string> {
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText}): ${url}`);
  }
  const body = await response.text();
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, body, 'utf8');
  return body;
}

interface FixtureRow {
  'Match Number': string;
  'Round Number': string;
  Date: string;
  'Home Team': string;
  'Away Team': string;
  Result: string;
}

/** fixturedownload dates are `DD/MM/YYYY HH:MM` in UK wall-clock time. */
export function parseFixtureDate(value: string): string {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) throw new Error(`Unrecognised fixture date: "${value}"`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Results look like `2 - 1`; fixtures not yet played have an empty Result cell. */
export function parseResult(value: string): { goalsHome: number; goalsAway: number } | null {
  const match = value.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return { goalsHome: Number(match[1]), goalsAway: Number(match[2]) };
}

export function parseSeasonCsv(csv: string, season: SeasonYear): HistoricalMatch[] {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as FixtureRow[];

  return rows.flatMap((row) => {
    const result = parseResult(row.Result ?? '');
    if (!result) return [];
    return [
      {
        season,
        matchday: Number(row['Round Number']),
        date: parseFixtureDate(row.Date),
        homeClub: toClubEloName(row['Home Team']),
        awayClub: toClubEloName(row['Away Team']),
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
      },
    ];
  });
}

interface ClubEloHistoryRow {
  Club: string;
  Elo: string;
  From: string;
  To: string;
}

export function parseClubEloHistory(csv: string): EloInterval[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ClubEloHistoryRow[];

  return rows
    .flatMap((row) => {
      const elo = Number(row.Elo);
      if (!row.From || !row.To || !Number.isFinite(elo)) return [];
      return [{ from: row.From, to: row.To, elo }];
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}

/**
 * Rating current on `date`. Intervals are half-open in practice but clubelo publishes them
 * inclusive, so a date lands in exactly one window; dates before the first window fall back
 * to the earliest rating on record.
 */
export function eloOn(history: EloHistory, club: string, date: string): number {
  const intervals = history.get(club);
  if (!intervals || intervals.length === 0) {
    throw new Error(`No Elo history for "${club}"`);
  }

  let low = 0;
  let high = intervals.length - 1;
  let candidate: EloInterval | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const interval = intervals[mid]!;
    if (interval.from > date) {
      high = mid - 1;
    } else {
      candidate = interval;
      low = mid + 1;
    }
  }

  // A date past the final window still resolves to the last known rating, which is what a
  // caller asking about a recent match wants.
  return (candidate ?? intervals[0]!).elo;
}

export interface LoadHistoricalOptions {
  seasons: SeasonYear[];
  cacheDir?: string;
}

export interface HistoricalDataset {
  matches: HistoricalMatch[];
  eloHistory: EloHistory;
}

export async function loadHistoricalDataset(
  options: LoadHistoricalOptions,
): Promise<HistoricalDataset> {
  const cacheDir = options.cacheDir ?? defaultCacheDir();

  const matches: HistoricalMatch[] = [];
  for (const season of options.seasons) {
    const csv = await cachedFetch(seasonCsvUrl(season), join(cacheDir, `epl-${season}.csv`));
    matches.push(...parseSeasonCsv(csv, season));
  }
  matches.sort((a, b) => a.date.localeCompare(b.date) || a.season - b.season);

  const clubs = [...new Set(matches.flatMap((m) => [m.homeClub, m.awayClub]))].sort();
  const eloHistory: EloHistory = new Map();
  for (const club of clubs) {
    const csv = await cachedFetch(
      clubEloHistoryUrl(club),
      join(cacheDir, 'elo', `${club.replace(/\s+/g, '')}.csv`),
    );
    const intervals = parseClubEloHistory(csv);
    if (intervals.length === 0) {
      throw new Error(`clubelo returned no usable history for "${club}"`);
    }
    eloHistory.set(club, intervals);
  }

  return { matches, eloHistory };
}
