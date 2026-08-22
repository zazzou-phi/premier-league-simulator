import type { AccuracyReport } from '@shared/engine/accuracy.js';
import type { AccuracyHistoryPoint, TeamEloSnapshot } from '@shared/db/repository.js';
import type { PickStrategy } from '@shared/engine/pickStrategy.js';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';

export type { PublicBootstrap, PublicMeta } from '@shared/export/publicSnapshot.js';
// The in-season loop's shapes are the engine's; the browser only ever reads them off the wire,
// so every import here stays type-only — `season/weekRun.ts` itself is node-only code.
export type {
  WeekExportSummary,
  WeekProgressEvent,
  WeekProjectionSummary,
  WeekRunEvent,
  WeekRunResult,
  WeekStep,
  WeekStepEvent,
  WeekStepResult,
  WeekStepResultEvent,
} from '@shared/season/weekRun.js';
export type { AccuracyHistoryPoint, TeamEloSnapshot };

export interface ApiErrorBody {
  error: string;
  code?: string;
}

/** A failed request that carried a machine-readable `code`, so a caller can offer the fix. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

// Sourced from `@shared/engine/accuracy.js` rather than the repository, so the web build
// never has to resolve the engine's SQLite types.
export interface PredictionAccuracy extends AccuracyReport {
  predictionId: number;
  name: string;
  runs: number;
  pickStrategy: PickStrategy;
  asOfMatchday: number | null;
  createdAt: string;
}

export interface Prediction {
  id: number;
  name: string;
  runs: number;
  pickStrategy: PickStrategy;
  /** Lowest matchday still unplayed when the batch ran; null for pre-provenance rows. */
  asOfMatchday: number | null;
  lockedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListPage<T> {
  items: T[];
  total: number;
}

export type PredictionListPage = ListPage<Prediction>;

export interface MonteCarloRunResult {
  predictionId: number;
  runs: number;
  elapsedMs: number;
  teams: TeamSeasonProjection[];
}

export interface ProjectionsResponse {
  runs: number;
  teams: TeamSeasonProjection[];
}

export interface SettingValue {
  value: number;
}