import type { ActualMatchResult, Fixture, SeasonState, Team } from '../engine/types.js';
import type { MatchDistribution, TeamSeasonProjection } from '../simulation/monteCarlo.js';
import type {
  MatchdayProjection,
  Prediction,
  Repository,
  SeasonProjection,
  TeamEloSnapshot,
} from '../db/repository.js';

/**
 * What the published snapshot is willing to show: all of it. The site is general interest, not
 * a contest against anyone, so there is nothing to give away by publishing the whole season —
 * and a public reader gets the same view the private app has, matchday cutoff included.
 *
 * The snapshot used to blank every round past the next one. The field survives that policy so
 * the JSON still says which one produced it, and so an older snapshot is still readable.
 */
export const REVEAL_POLICY = 'full';

export interface PublicMeta {
  exportedAt: string;
  revealPolicy: typeof REVEAL_POLICY;
  predictionId: number | null;
  predictionName: string | null;
  /** Lowest matchday still unplayed when the published batch ran. */
  asOfMatchday: number | null;
  runs: number;
  /**
   * Which projection each matchday was published through — the same attachment the private app
   * reads. Absent from snapshots exported before matchdays could carry their own projection.
   */
  matchdays: MatchdayProjection[];
}

export interface PublicBootstrap {
  teams: Team[];
  fixtures: Fixture[];
  actualResults: ActualMatchResult[];
  /** Dated Elo snapshots, oldest first — past ratings, not future predictions. */
  eloHistory: TeamEloSnapshot[];
}

/**
 * The actuals-only table is not exported: the web client derives it from
 * `bootstrap.actualResults` with the same engine code, and no client ever fetched the file.
 */
export interface PublicSnapshot {
  meta: PublicMeta;
  bootstrap: PublicBootstrap;
  leagueState: SeasonState | null;
  projections: { runs: number; teams: TeamSeasonProjection[] } | null;
  /**
   * The finishing odds of every batch a matchday is read through, one entry per batch. Without
   * these a static site could only ever show the newest run's table, so the matchweek picker
   * and the trend across matchweeks would be private-mode features.
   */
  seasonProjections: SeasonProjection[];
  /** Per-fixture distributions, one per fixture, ordered by match number. */
  distributions: MatchDistribution[];
}

export function buildPublicSnapshot(repo: Repository, exportedAt = new Date()): PublicSnapshot {
  const prediction: Prediction | null = repo.getActivePrediction();

  // The season goes out as the private app reads it: every matchday through the projection
  // attached to it, not the newest batch flattened over the whole calendar. The season-wide
  // finishing odds stay with the active batch, which is the only one that projects a table.
  const matchdays = repo.resolveMatchdayProjections();
  const leagueState = prediction ? repo.buildAssignedSeasonState() : null;
  const projections = prediction ? repo.getPredictionProjections(prediction.id) : null;

  // Every match, in fixture order: the spread behind a pick is exactly as public as the pick,
  // and it comes from whichever batch supplied that pick.
  const distributions = prediction ? repo.getAssignedDistributions() : [];
  const seasonProjections = prediction ? repo.getAssignedProjections() : [];

  return {
    meta: {
      exportedAt: exportedAt.toISOString(),
      revealPolicy: REVEAL_POLICY,
      predictionId: prediction?.id ?? null,
      predictionName: prediction?.name ?? null,
      asOfMatchday: prediction?.asOfMatchday ?? null,
      runs: prediction?.runs ?? 0,
      matchdays,
    },
    bootstrap: {
      teams: repo.getTeams(),
      fixtures: repo.getFixtures(),
      actualResults: repo.getActualResults(),
      eloHistory: repo.getEloHistory(),
    },
    leagueState,
    projections,
    seasonProjections,
    distributions,
  };
}

export function snapshotToFiles(snapshot: PublicSnapshot): Record<string, unknown> {
  return {
    'meta.json': snapshot.meta,
    'bootstrap.json': snapshot.bootstrap,
    'league-state.json': snapshot.leagueState,
    'projections.json': snapshot.projections,
    'season-projections.json': snapshot.seasonProjections,
    'distributions.json': snapshot.distributions,
  };
}
