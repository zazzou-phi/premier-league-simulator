import { computeLeagueStandings, type PlayedMatch } from '../engine/standings.js';
import type { ActualMatchResult, Fixture, SeasonState, Team } from '../engine/types.js';
import type { TeamSeasonProjection } from '../simulation/monteCarlo.js';
import type { Prediction, Repository, TeamEloSnapshot } from '../db/repository.js';

export const REVEAL_POLICY = 'kickoff';

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

export interface PublicSnapshot {
  meta: PublicMeta;
  bootstrap: PublicBootstrap;
  leagueState: SeasonState | null;
  projections: { runs: number; teams: TeamSeasonProjection[] } | null;
  actualResultsState: SeasonState;
}

/**
 * Fixtures store UK wall-clock kickoffs (Europe/London, including BST). Compare the
 * current instant against that same calendar by formatting both into London local time.
 */
export function hasKickedOff(fixture: Fixture, at: Date): boolean {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const nowLocal = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  const kickoffLocal = `${fixture.date}T${fixture.time}`;
  return kickoffLocal <= nowLocal;
}

/**
 * Blank out predicted scores for fixtures that have not kicked off, then recompute the
 * table from what remains so the published standings cannot leak future predictions.
 */
export function redactUnrevealed(state: SeasonState, at: Date): SeasonState {
  const matches = state.matches.map((match) => {
    if (match.locked || hasKickedOff(match.fixture, at)) return match;
    return {
      ...match,
      result: { goalsHome: null, goalsAway: null, status: 'scheduled' as const },
    };
  });

  const played: PlayedMatch[] = matches.flatMap((match) =>
    match.result.goalsHome != null && match.result.goalsAway != null
      ? [
          {
            homeTeamId: match.teamHome.id,
            awayTeamId: match.teamAway.id,
            goalsHome: match.result.goalsHome,
            goalsAway: match.result.goalsAway,
          },
        ]
      : [],
  );

  return {
    ...state,
    matches,
    standings: computeLeagueStandings(state.teams, played),
    matchesPlayed: played.length,
  };
}

export function buildPublicSnapshot(repo: Repository, exportedAt = new Date()): PublicSnapshot {
  const prediction: Prediction | null = repo.getActivePrediction();

  const leagueState = prediction
    ? redactUnrevealed(repo.buildPredictionState(prediction.id), exportedAt)
    : null;
  const projections = prediction ? repo.getPredictionProjections(prediction.id) : null;

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
    actualResultsState: redactUnrevealed(repo.buildActualResultsState(), exportedAt),
  };
}

export function snapshotToFiles(snapshot: PublicSnapshot): Record<string, unknown> {
  return {
    'meta.json': snapshot.meta,
    'bootstrap.json': snapshot.bootstrap,
    'league-state.json': snapshot.leagueState,
    'projections.json': snapshot.projections,
    'actual-results-state.json': snapshot.actualResultsState,
  };
}
