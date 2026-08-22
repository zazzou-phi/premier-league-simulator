import type { MatchDistribution } from '@shared/simulation/monteCarlo.js';
import type { ActualMatchResult, Fixture, SeasonState, Team } from '@shared/engine/types.js';
import type { TeamEloSnapshot } from '../types.js';
import type { ProjectionsResponse, PublicBootstrap, PublicMeta } from '../types.js';

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
 * Distributions for the revealed matches, keyed by fixture. One file for the whole set: it is a
 * few tens of KB, and the alternative — a request per match — would make a click wait on the
 * network for data already published.
 */
export async function loadDistributions(): Promise<Map<number, MatchDistribution>> {
  if (!cachedDistributions) {
    // Snapshots exported before distributions were published simply have no file.
    const list = await loadJson<MatchDistribution[]>('distributions.json').catch(() => []);
    cachedDistributions = new Map(list.map((entry) => [entry.matchNumber, entry]));
  }
  return cachedDistributions;
}

export const staticApi = {
  listTeams: async (): Promise<Team[]> => (await loadBootstrap()).teams,

  listFixtures: async (): Promise<Fixture[]> => (await loadBootstrap()).fixtures,

  getSeasonState: (): Promise<SeasonState> => loadJson<SeasonState>('league-state.json'),

  getProjections: (): Promise<ProjectionsResponse> =>
    loadJson<ProjectionsResponse>('projections.json'),

  listActualResults: async (): Promise<ActualMatchResult[]> => (await loadBootstrap()).actualResults,

  // Older snapshots predate the field; treat a missing series as "no history yet".
  listEloHistory: async (): Promise<TeamEloSnapshot[]> => (await loadBootstrap()).eloHistory ?? [],

  getMatchDistribution: async (matchNumber: number): Promise<MatchDistribution> => {
    const distribution = (await loadDistributions()).get(matchNumber);
    if (!distribution) {
      throw new Error('This match is not revealed yet');
    }
    return distribution;
  },
};
