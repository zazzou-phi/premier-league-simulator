import type { PickStrategy } from '@shared/engine/pickStrategy.js';
import type { MatchDistribution } from '@shared/simulation/monteCarlo.js';
import type { ActualMatchResult, Fixture, SeasonState, Team } from '@shared/engine/types.js';
import type { AccuracyHistoryPoint, TeamEloSnapshot } from '../types.js';
import { isPublicMode } from '../config/appMode.js';
import { DEFAULT_UPSET_VARIANCE } from '../lib/upsetVariance.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from '../lib/seasonForm.js';
import { staticApi } from './staticClient.js';
import { ApiRequestError } from '../types.js';
import type {
  ApiErrorBody,
  MonteCarloRunResult,
  Prediction,
  PredictionAccuracy,
  PredictionListPage,
  ProjectionsResponse,
  SettingValue,
  WeekRunEvent,
  WeekRunResult,
} from '../types.js';

/** Either side of the predictor payoff may be sent alone; the other keeps its stored value. */
export interface MonteCarloOptions {
  upsetVariance?: number;
  name?: string;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * The in-season loop, streamed. `onEvent` sees the run as it happens — one event per step, plus
 * Monte Carlo progress while the projection runs — and `started` reports how many steps to
 * expect, since the browser cannot import the engine's node-only step count.
 */
export interface WeekRunOptions {
  runs?: number;
  name?: string;
  dryRun?: boolean;
  skipRatings?: boolean;
  skipExport?: boolean;
  /** Accept a remote scoreline that overwrites one already recorded here. */
  force?: boolean;
  onEvent?: (event: WeekStreamEvent) => void;
}

export interface WeekStartedEvent {
  type: 'started';
  steps: number;
  runs: number;
  dryRun: boolean;
}

export type WeekStreamEvent = WeekRunEvent | WeekStartedEvent;

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
  runWeek(options?: WeekRunOptions): Promise<WeekRunResult>;

  listPredictions(page?: number, pageSize?: number): Promise<PredictionListPage>;
  renamePrediction(id: number, name: string): Promise<Prediction>;
  setPredictionPickStrategy(id: number, pickStrategy: PickStrategy): Promise<Prediction>;
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
  await throwIfNotOk(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  throw new ApiRequestError(body?.error ?? `Request failed (${res.status})`, body?.code);
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

/**
 * Progress repaints are starved without yielding, since the stream resolves in microtasks that
 * never let the browser reach a paint. A bare rAF would deadlock the read loop whenever the
 * browser is not painting (an occluded or minimised window still reports visibilityState
 * "visible"), so it is raced with a timer.
 */
function yieldFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
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
}

/** POST asking for the streaming form of a long-running endpoint. */
async function postNdjson(path: string, body: unknown): Promise<Response> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
  if (!res.body) throw new Error(`${path} returned no response body`);
  return res;
}

/** Read an NDJSON response line by line, handing each parsed line to `handle` in order. */
async function readNdjson(res: Response, handle: (event: unknown) => Promise<void>): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = async (line: string) => {
    if (!line.trim()) return;
    await handle(JSON.parse(line) as unknown);
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
  if (buffer.trim()) await handleLine(buffer);
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
    const res = await postNdjson('/api/v1/simulate/monte-carlo', {
      runs,
      upsetVariance: options.upsetVariance,
      name: options.name,
    });

    let result: MonteCarloRunResult | null = null;
    await readNdjson(res, async (event) => {
      if (isMonteCarloResult(event)) {
        result = event;
        return;
      }
      if (isProgressLine(event)) {
        options.onProgress?.(event.completed, event.total);
        await yieldFrame();
      }
    });

    if (!result) {
      throw new Error('Monte Carlo run ended without a result');
    }
    return result;
  },

  runWeek: async (options = {}) => {
    const res = await postNdjson('/api/v1/week', {
      runs: options.runs,
      name: options.name,
      dryRun: options.dryRun,
      skipRatings: options.skipRatings,
      skipExport: options.skipExport,
      force: options.force,
    });

    // The run is already streaming by the time most things can go wrong, so a failure arrives
    // as a line rather than a status — including the conflict the caller can retry with force.
    let failure: ApiRequestError | null = null;
    let result: WeekRunResult | null = null;

    await readNdjson(res, async (event) => {
      const line = event as { type?: string } & Record<string, unknown>;
      if (line.type === 'error') {
        failure = new ApiRequestError(
          typeof line.error === 'string' ? line.error : 'The week run failed',
          typeof line.code === 'string' ? line.code : undefined,
        );
        return;
      }
      if (line.type === 'result') {
        const { type: _type, ...rest } = line;
        result = rest as unknown as WeekRunResult;
        return;
      }
      options.onEvent?.(line as WeekStreamEvent);
      if (line.type === 'progress') await yieldFrame();
    });

    if (failure) throw failure;
    if (!result) {
      throw new Error('The week run ended without a result');
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

  setPredictionPickStrategy: (id, pickStrategy) =>
    request<Prediction>(`/api/v1/predictions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pickStrategy }),
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
  runWeek: async () => unavailable(),

  listPredictions: async () => ({ items: [], total: 0 }),
  renamePrediction: async () => unavailable(),
  setPredictionPickStrategy: async () => unavailable(),
  deletePrediction: async () => unavailable(),
  getPredictionState: async () => staticApi.getSeasonState(),
  getPredictionProjections: async () => staticApi.getProjections(),
  getPredictionAccuracy: async () => unavailable(),
  // The snapshot carries distributions only for revealed matches, which is not enough to grade
  // a whole batch — the trend stays a private-mode view.
  getAccuracyHistory: async () => [],
  getMatchDistribution: async (_id, matchNumber) => staticApi.getMatchDistribution(matchNumber),

  getUpsetVariance: async () => ({ value: DEFAULT_UPSET_VARIANCE }),
  setUpsetVariance: async (value) => ({ value }),
  getSeasonEloDeltaWeight: async () => ({ value: DEFAULT_SEASON_ELO_DELTA_WEIGHT }),
  setSeasonEloDeltaWeight: async (value) => ({ value }),
};

export const api: LeagueApi = isPublicMode() ? publicApi : privateApi;

export { isPublicMode } from '../config/appMode.js';
