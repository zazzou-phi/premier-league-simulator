import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPremierLeagueFixturesCsv } from '../data/fetchFixtures.js';
import { syncTeamRatingsFromClubElo, type SyncRatingsSummary } from '../data/fetchRatings.js';
import { syncTeamRatingsFromResults } from '../data/syncRatingsFromResults.js';
import { syncActualResultsFromRemote, type SyncResultsSummary } from '../data/syncResults.js';
import type { Prediction, PredictionAccuracy, Repository } from '../db/repository.js';
import { REVEAL_POLICY, type PublicMeta } from '../export/publicSnapshot.js';
import { writePublicSnapshot } from '../export/writePublicSnapshot.js';
import { pickGradeablePrediction } from '../scoring/report.js';
import { runMonteCarlo, type TeamSeasonProjection } from '../simulation/monteCarlo.js';

/**
 * The in-season loop, minus any way of reporting it: pull the weekend's results, refresh Elo,
 * grade the projection those results just settled, re-project the rest of the season and
 * re-export the public snapshot.
 *
 * The step order matters — projecting before syncing results would ignore the weekend — so it
 * is fixed here rather than left to whoever is typing, or clicking. `week-cli.ts` prints these
 * steps to a terminal and the API streams them to the browser; neither owns the order.
 */

export const WEEK_RUN_DEFAULT_RUNS = 10_000;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where public snapshots are written: `web/public/data` in a checkout, which is what the public
 * build reads and what the Pages workflow publishes. A container has no checkout to write back
 * to, so `PUBLIC_SNAPSHOT_DIR` redirects it at a mounted volume instead.
 */
export function getDefaultSnapshotDir(): string {
  const configured = process.env.PUBLIC_SNAPSHOT_DIR?.trim();
  return configured ? resolve(configured) : resolve(join(here, '../../../web/public/data'));
}

export type WeekStep = 'results' | 'ratings' | 'grading' | 'projection' | 'export';

export interface WeekStepEvent {
  type: 'step';
  step: WeekStep;
  /** 1-based position among the steps this run will take. */
  index: number;
  total: number;
  label: string;
}

export interface WeekProgressEvent {
  type: 'progress';
  step: 'projection';
  completed: number;
  total: number;
}

/** What a finished step produced, so a caller can render the run as it happens. */
export type WeekStepResult =
  | { step: 'results'; results: SyncResultsSummary }
  | { step: 'ratings'; ratings: SyncRatingsSummary | null }
  | { step: 'grading'; graded: WeekGradeSummary | null }
  | { step: 'projection'; projection: WeekProjectionSummary }
  | { step: 'export'; export: WeekExportSummary };

export type WeekStepResultEvent = { type: 'step-result' } & WeekStepResult;

export type WeekRunEvent = WeekStepEvent | WeekProgressEvent | WeekStepResultEvent;

export interface WeekRunOptions {
  runs?: number;
  name?: string;
  dryRun?: boolean;
  skipRatings?: boolean;
  /**
   * Refresh ratings from clubelo instead of recomputing them from real results.
   *
   * Off by default. `api.clubelo.com` has published nothing since 22 August 2026, so this
   * fails by design rather than silently changing the rating source mid-season; it exists so
   * the old feed can be opted back into deliberately once it returns.
   */
  useClubElo?: boolean;
  skipExport?: boolean;
  /** Accept a remote scoreline that overwrites one already recorded here. */
  force?: boolean;
  exportDir?: string;
  /** Pre-fetched fixtures CSV; when omitted, downloads from fixturedownload. */
  csv?: string;
  /** When true (default), refresh the tracked `data/*.csv` with what was just synced. */
  writeCsv?: boolean;
  onEvent?: (event: WeekRunEvent) => void;
}

export interface WeekGradeSummary {
  prediction: Prediction;
  accuracy: PredictionAccuracy;
}

export interface WeekProjectionSummary {
  name: string;
  /** Lowest matchday still unplayed once the weekend is banked; null when the season is done. */
  matchday: number | null;
  /** Why no projection was saved, or null when one was. */
  skipped: 'season-complete' | 'dry-run' | null;
  predictionId?: number;
  runs?: number;
  elapsedMs?: number;
  teams?: TeamSeasonProjection[];
}

export interface WeekExportSummary {
  dir: string;
  revealPolicy: PublicMeta['revealPolicy'];
}

export interface WeekRunResult {
  dryRun: boolean;
  results: SyncResultsSummary;
  /** null when the Club Elo refresh was skipped. */
  ratings: SyncRatingsSummary | null;
  /** null when no earlier projection has gradeable results yet. */
  graded: WeekGradeSummary | null;
  projection: WeekProjectionSummary;
  /** null when the snapshot export was skipped. */
  export: WeekExportSummary | null;
}

/**
 * The remote changed a result already recorded here. That is usually a corrected scoreline, but
 * it silently rewrites recorded history and the grades of every past projection, so it needs a
 * decision rather than a default.
 */
export class RemoteResultsChangedError extends Error {
  readonly code = 'REMOTE_RESULTS_CHANGED';

  constructor(readonly overwritten: number) {
    super(
      `The remote has changed ${overwritten} result(s) that were already recorded. ` +
        'Re-run with force to accept the changes.',
    );
    this.name = 'RemoteResultsChangedError';
  }
}

/** How many steps a run with these options will take, so a caller can size a progress display. */
export function countWeekSteps(options: Pick<WeekRunOptions, 'skipExport'> = {}): number {
  return options.skipExport ? 4 : 5;
}

function defaultProjectionName(matchday: number | null, today: string): string {
  return matchday == null ? `Final · ${today}` : `MD${matchday} · ${today}`;
}

export async function runWeek(
  repo: Repository,
  options: WeekRunOptions = {},
): Promise<WeekRunResult> {
  const {
    runs = WEEK_RUN_DEFAULT_RUNS,
    dryRun = false,
    skipRatings = false,
    useClubElo = false,
    skipExport = false,
    force = false,
    writeCsv = true,
    exportDir = getDefaultSnapshotDir(),
    onEvent,
  } = options;

  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('runs must be a positive integer');
  }

  const total = countWeekSteps({ skipExport });
  let index = 0;
  const step = (stepName: WeekStep, label: string) => {
    index += 1;
    onEvent?.({ type: 'step', step: stepName, index, total, label });
  };
  const stepResult = (result: WeekStepResult) => onEvent?.({ type: 'step-result', ...result });

  // ------------------------------------------------------------------ results

  step('results', 'Syncing results from fixturedownload');

  const csv = options.csv ?? (await fetchPremierLeagueFixturesCsv());
  const preview = await syncActualResultsFromRemote({ repo, csv, writeCsv, dryRun: true });

  if (preview.overwritten > 0 && !force && !dryRun) {
    throw new RemoteResultsChangedError(preview.overwritten);
  }

  const results = dryRun
    ? preview
    : await syncActualResultsFromRemote({ repo, csv, writeCsv, dryRun: false });
  stepResult({ step: 'results', results });

  // ------------------------------------------------------------------ ratings

  step(
    'ratings',
    skipRatings
      ? 'Skipping the ratings update'
      : useClubElo
        ? 'Refreshing Club Elo from clubelo'
        : 'Updating ratings from results',
  );

  // Ratings run before the projection on purpose: the batch below simulates from `teams.elo`,
  // and drifts only on its own results, so the weekend has to be in the rating by now.
  const ratings = skipRatings
    ? null
    : useClubElo
      ? await syncTeamRatingsFromClubElo({ repo, writeCsv, dryRun })
      : await syncTeamRatingsFromResults({ repo, dryRun });
  stepResult({ step: 'ratings', ratings });

  // ------------------------------------------------------------------ grading

  step('grading', 'Grading the previous projection');

  // Chosen after the sync, so it is the batch this weekend just settled rather than the one
  // settled a week ago — but still before the new batch is saved, which would otherwise be the
  // newest gradeable one the moment its first fixture is played.
  const previous = pickGradeablePrediction(repo);

  const graded = previous
    ? { prediction: previous, accuracy: repo.getPredictionAccuracy(previous.id) }
    : null;
  stepResult({ step: 'grading', graded });

  // --------------------------------------------------------------- projection

  const matchday = repo.getNextMatchday();
  const name =
    options.name?.trim() ||
    defaultProjectionName(matchday, new Date().toISOString().slice(0, 10));

  step('projection', `Projecting the rest of the season as "${name}"`);

  const projection: WeekProjectionSummary = { name, matchday, skipped: null };

  if (matchday == null) {
    projection.skipped = 'season-complete';
  } else if (dryRun) {
    projection.skipped = 'dry-run';
    projection.runs = runs;
  } else {
    const settings = repo.getSettings();
    const result = await runMonteCarlo(repo.getTeams(), repo.getFixtures(), {
      runs,
      upsetVariance: settings.upsetVariance,
      eloDeltaWeight: settings.seasonEloDeltaWeight,
      lockedResults: repo.getActualResultsByMatch(),
      onProgress: (completed, runTotal) => {
        onEvent?.({ type: 'progress', step: 'projection', completed, total: runTotal });
      },
    });

    const prediction = repo.savePredictionFromMonteCarlo(name, result);
    projection.predictionId = prediction.id;
    projection.runs = result.runs;
    projection.elapsedMs = result.elapsedMs;
    projection.teams = result.teams;
  }

  stepResult({ step: 'projection', projection });

  // ------------------------------------------------------------------- export

  let exported: WeekExportSummary | null = null;

  if (!skipExport) {
    step('export', 'Writing the public snapshot');
    if (dryRun) {
      exported = { dir: exportDir, revealPolicy: REVEAL_POLICY };
    } else {
      const meta = await writePublicSnapshot(repo, exportDir);
      exported = { dir: exportDir, revealPolicy: meta.revealPolicy };
    }
    stepResult({ step: 'export', export: exported });
  }

  return { dryRun, results, ratings, graded, projection, export: exported };
}
