import type { WeekStreamEvent } from '../api/client.js';
import type { WeekRunResult, WeekStep, WeekStepResult } from '../types.js';

/** One step of the in-season loop, and what it reported once it finished. */
export interface WeekStepEntry {
  step: WeekStep;
  label: string;
  index: number;
  /** null while the step is still running. */
  result: WeekStepResult | null;
}

export interface WeekRunState {
  running: boolean;
  /** Whether this run is reporting what would change rather than changing it. */
  dryRun: boolean;
  /** How many steps this run will take; null until the server says. */
  totalSteps: number | null;
  steps: WeekStepEntry[];
  /** Monte Carlo progress within the projection step. */
  progress: { completed: number; total: number } | null;
  result: WeekRunResult | null;
  error: string | null;
  /** The error's machine-readable code, when the server gave one. */
  errorCode: string | null;
}

export const IDLE_WEEK_RUN: WeekRunState = {
  running: false,
  dryRun: false,
  totalSteps: null,
  steps: [],
  progress: null,
  result: null,
  error: null,
  errorCode: null,
};

export const STARTED_WEEK_RUN: WeekRunState = { ...IDLE_WEEK_RUN, running: true };

/**
 * Fold one streamed event into the log. The server names the steps and their order, so the
 * browser never has to know what the loop does — only how to draw it.
 */
export function applyWeekEvent(state: WeekRunState, event: WeekStreamEvent): WeekRunState {
  switch (event.type) {
    case 'started':
      return { ...state, totalSteps: event.steps, dryRun: event.dryRun };

    case 'step':
      return {
        ...state,
        steps: [...state.steps, { step: event.step, label: event.label, index: event.index, result: null }],
        totalSteps: state.totalSteps ?? event.total,
      };

    case 'progress':
      return { ...state, progress: { completed: event.completed, total: event.total } };

    case 'step-result': {
      const { type: _type, ...result } = event;
      return {
        ...state,
        progress: event.step === 'projection' ? null : state.progress,
        steps: state.steps.map((entry) =>
          entry.step === event.step && entry.result == null
            ? { ...entry, result: result as WeekStepResult }
            : entry,
        ),
      };
    }
  }
}
