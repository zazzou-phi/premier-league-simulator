import { findNextMatchday } from '../engine/schedule.js';
import { computeLeagueStandings, type PlayedMatch } from '../engine/standings.js';
import type { ActualMatchResult, Fixture, SeasonState, Team } from '../engine/types.js';
import type { MatchDistribution, TeamSeasonProjection } from '../simulation/monteCarlo.js';
import type { Prediction, Repository, TeamEloSnapshot } from '../db/repository.js';

/**
 * What the published snapshot is willing to show: every round up to and including the next one
 * to be played. A forecast is worth more before kickoff than after it, so the upcoming round is
 * published in advance rather than only once it can no longer be wrong.
 *
 * Two things this deliberately does not change. Later rounds stay blank, so the snapshot still
 * cannot be read as a season-long script; and the published table is still built only from
 * matches that have actually kicked off, so revealing the next round never moves the standings.
 */
export const REVEAL_POLICY = 'next-round';

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
  /** Per-fixture distributions, for revealed matches only — the same set as the shown scores. */
  distributions: MatchDistribution[];
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

/** The round the season is on: the lowest matchday with a fixture still to be played. */
export function nextRound(fixtures: Fixture[], playedMatchNumbers: ReadonlySet<number>): number | null {
  return findNextMatchday(fixtures, playedMatchNumbers);
}

/**
 * Whether a fixture's predicted scoreline may be published: it is already a recorded result, it
 * has kicked off, or it belongs to a round no later than the next one to be played. The last
 * clause is what publishes a forecast in advance; the first two keep the set monotone, so a
 * fixture never becomes secret again once shown.
 */
export function isRevealed(
  match: SeasonState['matches'][number],
  at: Date,
  round: number | null,
): boolean {
  if (match.locked || hasKickedOff(match.fixture, at)) return true;
  return round != null && match.fixture.matchday <= round;
}

/**
 * Blank out predicted scores for fixtures beyond the next round, then recompute the table from
 * matches that have actually kicked off. The two sets differ on purpose: the upcoming round is
 * shown as a forecast, but standings built from it would imply results nobody has played yet.
 */
export function redactUnrevealed(state: SeasonState, at: Date): SeasonState {
  const round = nextRound(
    state.matches.map((match) => match.fixture),
    new Set(state.matches.filter((match) => match.locked).map((match) => match.fixture.matchNumber)),
  );

  const matches = state.matches.map((match) => {
    if (isRevealed(match, at, round)) return match;
    return {
      ...match,
      result: { goalsHome: null, goalsAway: null, status: 'scheduled' as const },
    };
  });

  const played: PlayedMatch[] = matches.flatMap((match) =>
    (match.locked || hasKickedOff(match.fixture, at)) &&
    match.result.goalsHome != null &&
    match.result.goalsAway != null
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

  // Exported for exactly the matches whose scoreline is shown: publishing the spread behind a
  // pick tells a reader nothing the pick did not already, and withholding every other match
  // keeps the rest of the season out of the snapshot.
  const distributions =
    prediction && leagueState
      ? distributionsForRevealed(repo.getPredictionDistributions(prediction.id), leagueState)
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

function distributionsForRevealed(
  byMatch: Map<number, MatchDistribution>,
  leagueState: SeasonState,
): MatchDistribution[] {
  return leagueState.matches.flatMap((match) => {
    if (match.result.goalsHome == null) return [];
    const distribution = byMatch.get(match.fixture.matchNumber);
    return distribution ? [distribution] : [];
  });
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
