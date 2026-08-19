import type { Team } from './types.js';

export const DEFAULT_SEASON_ELO_K = 20;

/**
 * How much a simulated run of form moves a club off its base Elo. Defaults to a full-weight
 * Elo update.
 *
 * Only *simulated* results drift a rating. Real ones contribute nothing: `fetch:ratings`
 * refreshes each club's base rating from clubelo weekly and that rating has already priced
 * them in, so drifting on them again would count the same form twice. A batch projecting from
 * matchday 12 therefore starts every club at today's clubelo number and lets only matchdays
 * 12–38 move it.
 *
 * An earlier revision defaulted this to 0, on walk-forward evidence that drift was neither
 * significant (chi2(2) = 4.11, p = 0.13) nor useful (-0.00085 log-likelihood per match over
 * 152 matchday origins). That measurement accumulated drift over *real, already-observed*
 * results to predict the *next* matchday — which is exactly the double-count described above,
 * and says nothing about how a counterfactual season should evolve from its origin.
 *
 * The question drift actually answers is whether simulated *final tables* are as spread out as
 * real ones. Against the five completed seasons in `engine/src/fitting`, weight 0 is
 * under-dispersed: SD of points across the 20 clubs comes out at 16.0 against a historical
 * 18.0, about 3.2 standard errors low. Weight 1 closes half of that (17.0) at no cost to the
 * match-level fit — league H/D/A moves 44.2/22.3/33.5 to 43.8/22.5/33.7 and goals per match
 * 2.940 to 2.939, since drift is close to zero-sum and mostly reshuffles *which* fixtures are
 * mismatched. Weight 1.5 matches the historical dispersion almost exactly but is not the
 * default: part of the residual gap is clubelo's pre-season ratings being shrunk toward the
 * mean, and tuning drift to absorb that would be fitting a confound on five seasons.
 *
 * Calibrated to final-table dispersion, then, not to per-match likelihood.
 */
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
