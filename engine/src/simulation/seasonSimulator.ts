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
  /**
   * True when this came from a recorded real-world result rather than the model. Always false
   * for anything {@link simulateSeason} produces — locked fixtures are not simulated at all.
   * `runMonteCarlo` re-attaches them, carrying this flag, once per batch.
   */
  locked: boolean;
}

export interface SeasonSimulationOptions {
  baselineHome?: number;
  baselineAway?: number;
  upsetVariance?: number;
  eloK?: number;
  eloDeltaWeight?: number;
  rng?: RandomSource;
}

export interface SeasonSimulationResult {
  matches: SeasonMatchResult[];
  eloDeltas: Map<number, number>;
}

/**
 * Fixtures in the order they are played. Hoisted out of the Monte Carlo hot loop — the order
 * is a property of the fixture list, not of a run, so it is computed once per batch.
 */
export function orderFixtures(fixtures: Fixture[]): Fixture[] {
  return [...fixtures].sort(
    (a, b) => a.matchday - b.matchday || a.matchNumber - b.matchNumber,
  );
}

/**
 * Play a season fixture by fixture, in the order given.
 *
 * Every fixture handed to this function is simulated — locked ones are filtered out by the
 * caller and never reach it, which is what confines Elo drift to simulated results.
 *
 * Form updates after every match, so a club's later fixtures in a matchday already see its
 * earlier one. Callers should pass fixtures through {@link orderFixtures} first.
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

  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const eloDeltas = new Map<number, number>();
  const matches: SeasonMatchResult[] = [];

  for (const fixture of fixtures) {
    const home = teamsById.get(fixture.teamHomeId);
    const away = teamsById.get(fixture.teamAwayId);
    if (!home || !away) continue;

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
    const { goalsHome, goalsAway } = outcome;

    matches.push({
      matchNumber: fixture.matchNumber,
      teamHomeId: home.id,
      teamAwayId: away.id,
      goalsHome,
      goalsAway,
      locked: false,
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

  return { matches, eloDeltas };
}
