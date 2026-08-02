import type { Team } from './types.js';

export const DEFAULT_SEASON_ELO_K = 20;
export const DEFAULT_SEASON_ELO_DELTA_WEIGHT = 1;
export const SEASON_ELO_DELTA_WEIGHT_MAX = 5;

export interface EloMatchInput {
  matchNumber: number;
  teamHomeId: number;
  teamAwayId: number;
  goalsHome: number;
  goalsAway: number;
}

export function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

/** How far in-season form is allowed to move a team from its starting Elo. */
export function effectiveElo(
  baseElo: number,
  delta: number,
  deltaWeight: number = DEFAULT_SEASON_ELO_DELTA_WEIGHT,
): number {
  return baseElo + deltaWeight * delta;
}

export function matchEloDelta(
  homeElo: number,
  awayElo: number,
  goalsHome: number,
  goalsAway: number,
  k: number = DEFAULT_SEASON_ELO_K,
): [number, number] {
  const expectedHome = expectedScore(homeElo, awayElo);
  const actualHome = goalsHome > goalsAway ? 1 : goalsHome === goalsAway ? 0.5 : 0;
  const homeDelta = k * (actualHome - expectedHome);
  const awayDelta = k * (1 - actualHome - (1 - expectedHome));
  return [homeDelta, awayDelta];
}

export function computeEloDeltasFromMatches(
  teams: Team[] | Map<number, Team>,
  matches: EloMatchInput[],
  k: number = DEFAULT_SEASON_ELO_K,
): Map<number, number> {
  const teamsById = teams instanceof Map ? teams : new Map(teams.map((team) => [team.id, team]));
  const deltas = new Map<number, number>();

  for (const match of matches) {
    const home = teamsById.get(match.teamHomeId);
    const away = teamsById.get(match.teamAwayId);
    if (!home || !away) continue;

    const homeElo = home.elo + (deltas.get(home.id) ?? 0);
    const awayElo = away.elo + (deltas.get(away.id) ?? 0);
    const [homeDelta, awayDelta] = matchEloDelta(
      homeElo,
      awayElo,
      match.goalsHome,
      match.goalsAway,
      k,
    );
    deltas.set(home.id, (deltas.get(home.id) ?? 0) + homeDelta);
    deltas.set(away.id, (deltas.get(away.id) ?? 0) + awayDelta);
  }

  return deltas;
}
