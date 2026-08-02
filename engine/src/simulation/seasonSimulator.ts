import {
  DEFAULT_BASELINE_AWAY,
  DEFAULT_BASELINE_HOME,
  DEFAULT_UPSET_VARIANCE,
  defaultRandomSource,
  simulateMatchOutcome,
  type RandomSource,
} from '../engine/matchSimulator.js';
import {
  DEFAULT_SEASON_ELO_DELTA_WEIGHT,
  DEFAULT_SEASON_ELO_K,
  effectiveElo,
  matchEloDelta,
} from '../engine/seasonElo.js';
import type { Fixture, Team } from '../engine/types.js';

export interface SeasonMatchResult {
  matchNumber: number;
  teamHomeId: number;
  teamAwayId: number;
  goalsHome: number;
  goalsAway: number;
  /** True when this came from a recorded real-world result rather than the model. */
  locked: boolean;
}

export interface SeasonSimulationOptions {
  baselineHome?: number;
  baselineAway?: number;
  upsetVariance?: number;
  eloK?: number;
  eloDeltaWeight?: number;
  rng?: RandomSource;
  /** Real results keyed by match number; these are replayed instead of simulated. */
  lockedResults?: Map<number, { goalsHome: number; goalsAway: number }>;
}

export interface SeasonSimulationResult {
  matches: SeasonMatchResult[];
  eloDeltas: Map<number, number>;
}

interface MatchdayGroup {
  matchday: number;
  fixtures: Fixture[];
}

function groupByMatchday(fixtures: Fixture[]): MatchdayGroup[] {
  const byMatchday = new Map<number, Fixture[]>();
  for (const fixture of fixtures) {
    const list = byMatchday.get(fixture.matchday);
    if (list) list.push(fixture);
    else byMatchday.set(fixture.matchday, [fixture]);
  }
  return [...byMatchday.entries()]
    .sort(([a], [b]) => a - b)
    .map(([matchday, list]) => ({
      matchday,
      fixtures: list.sort((a, b) => a.matchNumber - b.matchNumber),
    }));
}

/**
 * Play a full season fixture by fixture.
 *
 * Form is refreshed once per matchday rather than after every match: fixtures inside a
 * matchday are concurrent in reality, and it keeps the Monte Carlo hot loop cheap.
 */
export function simulateSeason(
  teams: Team[],
  fixtures: Fixture[],
  options: SeasonSimulationOptions = {},
): SeasonSimulationResult {
  const baselineHome = options.baselineHome ?? DEFAULT_BASELINE_HOME;
  const baselineAway = options.baselineAway ?? DEFAULT_BASELINE_AWAY;
  const upsetVariance = options.upsetVariance ?? DEFAULT_UPSET_VARIANCE;
  const eloK = options.eloK ?? DEFAULT_SEASON_ELO_K;
  const eloDeltaWeight = options.eloDeltaWeight ?? DEFAULT_SEASON_ELO_DELTA_WEIGHT;
  const rng = options.rng ?? defaultRandomSource;
  const lockedResults = options.lockedResults;

  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const eloDeltas = new Map<number, number>();
  const matches: SeasonMatchResult[] = [];

  for (const { fixtures: matchdayFixtures } of groupByMatchday(fixtures)) {
    for (const fixture of matchdayFixtures) {
      const home = teamsById.get(fixture.teamHomeId);
      const away = teamsById.get(fixture.teamAwayId);
      if (!home || !away) continue;

      const locked = lockedResults?.get(fixture.matchNumber);
      let goalsHome: number;
      let goalsAway: number;

      if (locked) {
        goalsHome = locked.goalsHome;
        goalsAway = locked.goalsAway;
      } else {
        const outcome = simulateMatchOutcome(
          {
            ...home,
            elo: effectiveElo(home.elo, eloDeltas.get(home.id) ?? 0, eloDeltaWeight),
          },
          {
            ...away,
            elo: effectiveElo(away.elo, eloDeltas.get(away.id) ?? 0, eloDeltaWeight),
          },
          { baselineHome, baselineAway, upsetVariance, rng },
        );
        goalsHome = outcome.goalsHome;
        goalsAway = outcome.goalsAway;
      }

      matches.push({
        matchNumber: fixture.matchNumber,
        teamHomeId: home.id,
        teamAwayId: away.id,
        goalsHome,
        goalsAway,
        locked: locked != null,
      });

      const [homeDelta, awayDelta] = matchEloDelta(
        home.elo + (eloDeltas.get(home.id) ?? 0),
        away.elo + (eloDeltas.get(away.id) ?? 0),
        goalsHome,
        goalsAway,
        eloK,
      );
      eloDeltas.set(home.id, (eloDeltas.get(home.id) ?? 0) + homeDelta);
      eloDeltas.set(away.id, (eloDeltas.get(away.id) ?? 0) + awayDelta);
    }
  }

  return { matches, eloDeltas };
}
