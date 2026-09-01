import type { MatchDistribution } from '@shared/simulation/monteCarlo.js';
import type { ActualMatchResult, Fixture, SeasonState, Team } from '@shared/engine/types.js';
import type { TeamEloSnapshot } from '../types.js';
import type {
  MatchdayProjection,
  ProjectionsResponse,
  PublicBootstrap,
  PublicMeta,
  SeasonProjection,
} from '../types.js';

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

async function loadJson<T>(filename: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${filename}`);
  if (!res.ok) {
    throw new Error(`Failed to load ${filename} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

let cachedBootstrap: PublicBootstrap | null = null;
let cachedMeta: PublicMeta | null = null;
let cachedDistributions: Map<number, MatchDistribution> | null = null;
let cachedSeasonProjections: SeasonProjection[] | null = null;

export async function loadPublicMeta(): Promise<PublicMeta> {
  if (!cachedMeta) {
    cachedMeta = await loadJson<PublicMeta>('meta.json');
  }
  return cachedMeta;
}

export async function loadBootstrap(): Promise<PublicBootstrap> {
  if (!cachedBootstrap) {
    cachedBootstrap = await loadJson<PublicBootstrap>('bootstrap.json');
  }
  return cachedBootstrap;
}

/**
 * Every fixture's distribution, keyed by match number. One file for the whole set rather than a
 * request per match, which would make a click wait on the network for data already published.
 * It is fetched lazily, on the first distribution a reader opens, because publishing all 380
 * spreads costs a megabyte or so and most visits never open one.
 */
export async function loadDistributions(): Promise<Map<number, MatchDistribution>> {
  if (!cachedDistributions) {
    // Snapshots exported before distributions were published simply have no file.
    const list = await loadJson<MatchDistribution[]>('distributions.json').catch(() => []);
    cachedDistributions = new Map(list.map((entry) => [entry.matchNumber, entry]));
  }
  return cachedDistributions;
}

/**
 * The finishing odds of every batch the published season is read through, keyed by batch.
 *
 * Snapshots exported before matchweeks could be browsed carry only the active batch, so this
 * falls back to `projections.json` under the id `meta.json` names — one entry is exactly what
 * those snapshots have, and the matchweek picker degrades to the single week it covers.
 */
export async function loadSeasonProjections(): Promise<SeasonProjection[]> {
  if (!cachedSeasonProjections) {
    const published = await loadJson<SeasonProjection[]>('season-projections.json').catch(
      () => null,
    );
    if (published && published.length > 0) {
      cachedSeasonProjections = published;
    } else {
      const [meta, projections] = await Promise.all([
        loadPublicMeta(),
        staticApi.getProjections().catch(() => null),
      ]);
      cachedSeasonProjections =
        meta.predictionId == null || projections == null
          ? []
          : [{ predictionId: meta.predictionId, ...projections }];
    }
  }
  return cachedSeasonProjections;
}

export const staticApi = {
  listTeams: async (): Promise<Team[]> => (await loadBootstrap()).teams,

  listFixtures: async (): Promise<Fixture[]> => (await loadBootstrap()).fixtures,

  getSeasonState: (): Promise<SeasonState> => loadJson<SeasonState>('league-state.json'),

  // Snapshots exported before matchdays could carry their own projection have no such field;
  // an empty list reads as "the whole season came from one batch", which is what they are.
  listMatchdayProjections: async (): Promise<MatchdayProjection[]> =>
    (await loadPublicMeta()).matchdays ?? [],

  getProjections: (): Promise<ProjectionsResponse> =>
    loadJson<ProjectionsResponse>('projections.json'),

  listSeasonProjections: (): Promise<SeasonProjection[]> => loadSeasonProjections(),

  listActualResults: async (): Promise<ActualMatchResult[]> => (await loadBootstrap()).actualResults,

  // Older snapshots predate the field; treat a missing series as "no history yet".
  listEloHistory: async (): Promise<TeamEloSnapshot[]> => (await loadBootstrap()).eloHistory ?? [],

  getMatchDistribution: async (matchNumber: number): Promise<MatchDistribution> => {
    const distribution = (await loadDistributions()).get(matchNumber);
    if (!distribution) {
      throw new Error('This snapshot carries no distribution for that match');
    }
    return distribution;
  },
};
