import { computeLeagueStandings, type PlayedMatch } from '../engine/standings.js';
import type { Fixture, Team } from '../engine/types.js';
import {
  simulateSeason,
  type SeasonMatchResult,
  type SeasonSimulationOptions,
} from './seasonSimulator.js';

export const MONTE_CARLO_MAX_RUNS = 100_000;
export const DEFAULT_RESERVOIR_SIZE = 50;

export interface ScorelineCount {
  goalsHome: number;
  goalsAway: number;
  n: number;
}

export interface MatchOutcomeCounts {
  homeWin: number;
  draw: number;
  awayWin: number;
  total: number;
}

export interface MatchDistribution {
  matchNumber: number;
  outcomes: MatchOutcomeCounts;
  scorelines: ScorelineCount[];
}

export interface TeamSeasonProjection {
  teamId: number;
  teamName: string;
  /** positionCounts[i] is how often the team finished in position i+1. */
  positionCounts: number[];
  titleProbability: number;
  championsLeagueProbability: number;
  europeanProbability: number;
  relegationProbability: number;
  averagePosition: number;
  averagePoints: number;
  averageGoalsFor: number;
  averageGoalsAgainst: number;
}

export interface SampledSeason {
  runIndex: number;
  matches: SeasonMatchResult[];
}

export interface MonteCarloResult {
  runs: number;
  elapsedMs: number;
  teams: TeamSeasonProjection[];
  matchDistributions: MatchDistribution[];
  /** A uniform random subset of full seasons, kept so a coherent season can be replayed. */
  sampledSeasons: SampledSeason[];
}

export interface MonteCarloOptions extends SeasonSimulationOptions {
  runs: number;
  reservoirSize?: number;
  onProgress?: (completed: number, total: number) => void | Promise<void>;
}

interface TeamAccumulator {
  positionCounts: number[];
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  positionSum: number;
}

function shouldReportProgress(completed: number, total: number): boolean {
  if (completed === total) return true;
  const step = Math.max(1, Math.floor(total / 100));
  return completed % step === 0;
}

/**
 * Run many seasons, keeping only aggregate distributions in memory.
 *
 * Individual runs are deliberately not persisted; at 380 matches a run that would be
 * millions of rows for a large batch. A reservoir keeps a bounded, uniformly random
 * subset of whole seasons so consensus sampling still reflects a coherent season.
 */
export async function runMonteCarlo(
  teams: Team[],
  fixtures: Fixture[],
  options: MonteCarloOptions,
): Promise<MonteCarloResult> {
  const runs = Math.floor(options.runs);
  if (!Number.isFinite(runs) || runs < 1) {
    throw new Error(`runs must be a positive integer, got ${options.runs}`);
  }
  if (runs > MONTE_CARLO_MAX_RUNS) {
    throw new Error(`runs must not exceed ${MONTE_CARLO_MAX_RUNS}, got ${runs}`);
  }

  const reservoirSize = options.reservoirSize ?? DEFAULT_RESERVOIR_SIZE;
  const teamCount = teams.length;
  const startedAt = Date.now();

  const accumulators = new Map<number, TeamAccumulator>(
    teams.map((team) => [
      team.id,
      {
        positionCounts: new Array<number>(teamCount).fill(0),
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        positionSum: 0,
      },
    ]),
  );

  const outcomesByMatch = new Map<number, MatchOutcomeCounts>();
  const scorelinesByMatch = new Map<number, Map<string, ScorelineCount>>();
  const reservoir: SampledSeason[] = [];
  const rng = options.rng;

  for (let run = 0; run < runs; run++) {
    const { matches } = simulateSeason(teams, fixtures, options);

    const played: PlayedMatch[] = matches.map((match) => ({
      homeTeamId: match.teamHomeId,
      awayTeamId: match.teamAwayId,
      goalsHome: match.goalsHome,
      goalsAway: match.goalsAway,
    }));

    for (const match of matches) {
      let outcomes = outcomesByMatch.get(match.matchNumber);
      if (!outcomes) {
        outcomes = { homeWin: 0, draw: 0, awayWin: 0, total: 0 };
        outcomesByMatch.set(match.matchNumber, outcomes);
      }
      if (match.goalsHome > match.goalsAway) outcomes.homeWin += 1;
      else if (match.goalsHome < match.goalsAway) outcomes.awayWin += 1;
      else outcomes.draw += 1;
      outcomes.total += 1;

      let scorelines = scorelinesByMatch.get(match.matchNumber);
      if (!scorelines) {
        scorelines = new Map();
        scorelinesByMatch.set(match.matchNumber, scorelines);
      }
      const key = `${match.goalsHome}-${match.goalsAway}`;
      const existing = scorelines.get(key);
      if (existing) existing.n += 1;
      else scorelines.set(key, { goalsHome: match.goalsHome, goalsAway: match.goalsAway, n: 1 });
    }

    for (const row of computeLeagueStandings(teams, played)) {
      const acc = accumulators.get(row.teamId);
      if (!acc) continue;
      acc.positionCounts[row.position - 1] = (acc.positionCounts[row.position - 1] ?? 0) + 1;
      acc.positionSum += row.position;
      acc.points += row.points;
      acc.goalsFor += row.goalsFor;
      acc.goalsAgainst += row.goalsAgainst;
    }

    // Algorithm R: fill the reservoir, then replace with probability reservoirSize/run.
    if (reservoirSize > 0) {
      if (reservoir.length < reservoirSize) {
        reservoir.push({ runIndex: run, matches });
      } else {
        const j = Math.floor((rng?.random() ?? Math.random()) * (run + 1));
        if (j < reservoirSize) reservoir[j] = { runIndex: run, matches };
      }
    }

    const completed = run + 1;
    if (options.onProgress && shouldReportProgress(completed, runs)) {
      await options.onProgress(completed, runs);
    }
  }

  const relegationCutoff = teamCount - 3;

  const projections: TeamSeasonProjection[] = teams
    .map((team) => {
      const acc = accumulators.get(team.id)!;
      const countsIn = (from: number, to: number) =>
        acc.positionCounts.slice(from - 1, to).reduce((sum, n) => sum + n, 0);

      return {
        teamId: team.id,
        teamName: team.name,
        positionCounts: acc.positionCounts,
        titleProbability: (acc.positionCounts[0] ?? 0) / runs,
        championsLeagueProbability: countsIn(1, 4) / runs,
        europeanProbability: countsIn(1, 5) / runs,
        relegationProbability: countsIn(relegationCutoff + 1, teamCount) / runs,
        averagePosition: acc.positionSum / runs,
        averagePoints: acc.points / runs,
        averageGoalsFor: acc.goalsFor / runs,
        averageGoalsAgainst: acc.goalsAgainst / runs,
      };
    })
    .sort(
      (a, b) =>
        a.averagePosition - b.averagePosition ||
        b.averagePoints - a.averagePoints ||
        a.teamName.localeCompare(b.teamName),
    );

  const matchDistributions: MatchDistribution[] = [...outcomesByMatch.entries()]
    .map(([matchNumber, outcomes]) => ({
      matchNumber,
      outcomes,
      scorelines: [...(scorelinesByMatch.get(matchNumber)?.values() ?? [])].sort(
        (a, b) => b.n - a.n || a.goalsHome - b.goalsHome || a.goalsAway - b.goalsAway,
      ),
    }))
    .sort((a, b) => a.matchNumber - b.matchNumber);

  return {
    runs,
    elapsedMs: Date.now() - startedAt,
    teams: projections,
    matchDistributions,
    sampledSeasons: reservoir,
  };
}
