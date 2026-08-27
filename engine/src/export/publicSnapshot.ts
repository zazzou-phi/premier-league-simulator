import type { ActualMatchResult, Fixture, SeasonState, Team } from '../engine/types.js';
import type { MatchDistribution, TeamSeasonProjection } from '../simulation/monteCarlo.js';
import type { Prediction, Repository, TeamEloSnapshot } from '../db/repository.js';

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
  /** Per-fixture distributions, one per fixture, ordered by match number. */
  distributions: MatchDistribution[];
}

export function buildPublicSnapshot(repo: Repository, exportedAt = new Date()): PublicSnapshot {
  const prediction: Prediction | null = repo.getActivePrediction();

  const leagueState = prediction ? repo.buildPredictionState(prediction.id) : null;
  const projections = prediction ? repo.getPredictionProjections(prediction.id) : null;

  // Every match, in fixture order: the spread behind a pick is exactly as public as the pick.
  const distributions = prediction
    ? [...repo.getPredictionDistributions(prediction.id).values()].sort(
        (a, b) => a.matchNumber - b.matchNumber,
      )
    : [];

  return {
    meta: {
      exportedAt: exportedAt.toISOString(),
      revealPolicy: REVEAL_POLICY,
      predictionId: prediction?.id ?? null,
      predictionName: prediction?.name ?? null,
      asOfMatchday: prediction?.asOfMatchday ?? null,
      runs: prediction?.runs ?? 0,
    },
    bootstrap: {
      teams: repo.getTeams(),
      fixtures: repo.getFixtures(),
      actualResults: repo.getActualResults(),
      eloHistory: repo.getEloHistory(),
    },
    leagueState,
    projections,
    distributions,
  };
}

export function snapshotToFiles(snapshot: PublicSnapshot): Record<string, unknown> {
  return {
    'meta.json': snapshot.meta,
    'bootstrap.json': snapshot.bootstrap,
    'league-state.json': snapshot.leagueState,
    'projections.json': snapshot.projections,
    'distributions.json': snapshot.distributions,
  };
}
