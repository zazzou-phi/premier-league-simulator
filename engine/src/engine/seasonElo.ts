import type { Team } from './types.js';

export const DEFAULT_SEASON_ELO_K = 20;

/**
 * How much in-season drift moves a team off its base Elo. Defaults to 0 — drift off.
 *
 * `fetch:ratings` refreshes each club's base rating from clubelo, and that rating already
 * reflects every result so far this season, so adding drift on top counts the same form
 * twice. Fitting the weight as a free parameter against 2021/22–2025/26 finds it neither
 * significant (chi2(2) = 4.11, p = 0.13) nor useful: walk-forward over 152 matchday origins,
 * drift *cost* 0.00085 log-likelihood per match. The implied weights disagreed between the
 * home and away sides (0.145 and 0.401) and both sat far below the old default of 1.
 *
 * The lambda defaults in {@link matchSimulator} were also fitted with no drift applied, so a
 * non-zero weight would feed the model an input distribution it was not estimated on.
 *
 * Still a live setting: raise it to re-enable drift, which is coherent if the base Elo is a
 * season-start snapshot rather than a clubelo refresh.
 */
export const DEFAULT_SEASON_ELO_DELTA_WEIGHT = 0;
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
