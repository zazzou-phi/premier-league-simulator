import type { ConsensusMode } from '@shared/engine/consensus.js';
import type { MatchDistribution } from '@shared/simulation/monteCarlo.js';
import type { ActualMatchResult, Fixture, SeasonState, Team } from '@shared/engine/types.js';
import type { AccuracyHistoryPoint, TeamEloSnapshot } from '../types.js';
import { isPublicMode } from '../config/appMode.js';
import { DEFAULT_UPSET_VARIANCE } from '../lib/upsetVariance.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from '../lib/seasonForm.js';
import { staticApi } from './staticClient.js';
import type {
  ApiErrorBody,
  MonteCarloRunResult,
  Prediction,
  PredictionAccuracy,
  PredictionListPage,
  ProjectionsResponse,
  SettingValue,
} from '../types.js';

export interface MonteCarloOptions {
  upsetVariance?: number;
  name?: string;
  onProgress?: (completed: number, total: number) => void;
}

export interface LeagueApi {
  listTeams(): Promise<Team[]>;
  listEloHistory(): Promise<TeamEloSnapshot[]>;
  listFixtures(): Promise<Fixture[]>;

  listActualResults(): Promise<ActualMatchResult[]>;
  setActualResult(
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
  ): Promise<ActualMatchResult>;
  clearActualResult(matchNumber: number): Promise<void>;

  runMonteCarlo(runs: number, options?: MonteCarloOptions): Promise<MonteCarloRunResult>;

  listPredictions(page?: number, pageSize?: number): Promise<PredictionListPage>;
  renamePrediction(id: number, name: string): Promise<Prediction>;
  setPredictionConsensusMode(id: number, consensusMode: ConsensusMode): Promise<Prediction>;
  deletePrediction(id: number): Promise<void>;
  getPredictionState(id: number): Promise<SeasonState>;
  getPredictionProjections(id: number): Promise<ProjectionsResponse>;
  getPredictionAccuracy(id: number): Promise<PredictionAccuracy>;
  getAccuracyHistory(): Promise<AccuracyHistoryPoint[]>;
  getMatchDistribution(id: number, matchNumber: number): Promise<MatchDistribution>;

  getUpsetVariance(): Promise<SettingValue>;
  setUpsetVariance(value: number): Promise<SettingValue>;
  getSeasonEloDeltaWeight(): Promise<SettingValue>;
  setSeasonEloDeltaWeight(value: number): Promise<SettingValue>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Upper bound on a progress repaint yield, ~2 frames at 60Hz. */
const FRAME_YIELD_TIMEOUT_MS = 32;

function isMonteCarloResult(value: unknown): value is MonteCarloRunResult {
  return typeof value === 'object' && value !== null && Array.isArray((value as MonteCarloRunResult).teams);
}

function isProgressLine(value: unknown): value is { completed: number; total: number } {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as { completed?: unknown; total?: unknown };
  return typeof line.completed === 'number' && typeof line.total === 'number';
}

const privateApi: LeagueApi = {
  listTeams: () => request<Team[]>('/api/v1/teams'),

  listEloHistory: () => request<TeamEloSnapshot[]>('/api/v1/teams/elo-history'),

  listFixtures: () => request<Fixture[]>('/api/v1/fixtures'),

  listActualResults: () => request<ActualMatchResult[]>('/api/v1/actual-results'),

  setActualResult: (matchNumber, goalsHome, goalsAway) =>
    request<ActualMatchResult>(`/api/v1/actual-results/${matchNumber}`, {
      method: 'PUT',
      body: JSON.stringify({ goalsHome, goalsAway }),
    }),

  clearActualResult: (matchNumber) =>
    request<void>(`/api/v1/actual-results/${matchNumber}`, { method: 'DELETE' }),

  runMonteCarlo: async (runs, options = {}) => {
    const res = await fetch('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        runs,
        upsetVariance: options.upsetVariance,
        name: options.name,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new Error(body?.error ?? `Request failed (${res.status})`);
    }
    if (!res.body) {
      throw new Error('Monte Carlo run returned no response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: MonteCarloRunResult | null = null;

    // Progress repaints are starved without yielding, since the stream resolves in
    // microtasks that never let the browser reach a paint. A bare rAF would deadlock
    // the read loop whenever the browser is not painting (an occluded or minimised
    // window still reports visibilityState "visible"), so it is raced with a timer.
    const yieldFrame = () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(settle, FRAME_YIELD_TIMEOUT_MS);
        requestAnimationFrame(settle);
      });

    const handleLine = async (line: string) => {
      if (!line.trim()) return;
      const event: unknown = JSON.parse(line);
      if (isMonteCarloResult(event)) {
        result = event;
        return;
      }
      if (isProgressLine(event)) {
        options.onProgress?.(event.completed, event.total);
        await yieldFrame();
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        await handleLine(line);
      }
    }
    if (buffer.trim()) {
      await handleLine(buffer);
    }
    if (!result) {
      throw new Error('Monte Carlo run ended without a result');
    }
    return result;
  },

  listPredictions: (page = 1, pageSize = 50) =>
    request<PredictionListPage>(`/api/v1/predictions?page=${page}&pageSize=${pageSize}`),

  renamePrediction: (id, name) =>
    request<Prediction>(`/api/v1/predictions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  setPredictionConsensusMode: (id, consensusMode) =>
    request<Prediction>(`/api/v1/predictions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ consensusMode }),
    }),

  deletePrediction: (id) => request<void>(`/api/v1/predictions/${id}`, { method: 'DELETE' }),

  getPredictionState: (id) => request<SeasonState>(`/api/v1/predictions/${id}/state`),

  getPredictionProjections: (id) =>
    request<ProjectionsResponse>(`/api/v1/predictions/${id}/projections`),

  getPredictionAccuracy: (id) =>
    request<PredictionAccuracy>(`/api/v1/predictions/${id}/accuracy`),

  getAccuracyHistory: () => request<AccuracyHistoryPoint[]>('/api/v1/predictions/accuracy-history'),

  getMatchDistribution: (id, matchNumber) =>
    request<MatchDistribution>(`/api/v1/predictions/${id}/matches/${matchNumber}/distribution`),

  getUpsetVariance: () => request<SettingValue>('/api/v1/settings/upset-variance'),

  setUpsetVariance: (value) =>
    request<SettingValue>('/api/v1/settings/upset-variance', {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  getSeasonEloDeltaWeight: () => request<SettingValue>('/api/v1/settings/season-elo-delta-weight'),

  setSeasonEloDeltaWeight: (value) =>
    request<SettingValue>('/api/v1/settings/season-elo-delta-weight', {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
};

function unavailable(): never {
  throw new Error('Not available in public mode');
}

const publicApi: LeagueApi = {
  listTeams: staticApi.listTeams,
  listEloHistory: staticApi.listEloHistory,
  listFixtures: staticApi.listFixtures,

  listActualResults: staticApi.listActualResults,
  setActualResult: async () => unavailable(),
  clearActualResult: async () => unavailable(),

  runMonteCarlo: async () => unavailable(),

  listPredictions: async () => ({ items: [], total: 0 }),
  renamePrediction: async () => unavailable(),
  setPredictionConsensusMode: async () => unavailable(),
  deletePrediction: async () => unavailable(),
  getPredictionState: async () => staticApi.getSeasonState(),
  getPredictionProjections: async () => staticApi.getProjections(),
  getPredictionAccuracy: async () => unavailable(),
  // Grading needs per-fixture distributions, which the static snapshot deliberately omits.
  getAccuracyHistory: async () => [],
  getMatchDistribution: async () => unavailable(),

  getUpsetVariance: async () => ({ value: DEFAULT_UPSET_VARIANCE }),
  setUpsetVariance: async (value) => ({ value }),
  getSeasonEloDeltaWeight: async () => ({ value: DEFAULT_SEASON_ELO_DELTA_WEIGHT }),
  setSeasonEloDeltaWeight: async (value) => ({ value }),
};

export const api: LeagueApi = isPublicMode() ? publicApi : privateApi;

export { isPublicMode } from '../config/appMode.js';
