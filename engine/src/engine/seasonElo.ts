import type { Team } from './types.js';

/**
 * Step size of an Elo update, in rating points per unit of surprise.
 *
 * Held at 20 after `npm run fit:elo-k` re-fitted it for prediction rather than for final-table
 * dispersion: 25 tops the sweep but beats 20 by only +0.00088 log-likelihood per match
 * (SE 0.00085, t = 1.04), which is not a result.
 */
export const DEFAULT_SEASON_ELO_K = 20;

/**
 * How much a simulated run of form moves a club off its base Elo. Defaults to a full-weight
 * Elo update.
 *
 * Only *simulated* results drift a rating here. Real ones are already in the base:
 * `syncTeamRatingsFromResults` recomputes `teams.elo` as `anchor_elo` plus the Elo update from
 * every real result to date, so drifting on them again would count the same form twice. A
 * batch projecting from matchday 12 therefore starts every club at a rating that already
 * reflects matchdays 1–11, and lets only 12–38 move it.
 *
 * That division is new, but the shape is not. It is the arrangement clubelo used to provide —
 * an externally refreshed base plus counterfactual drift on top — with the engine's own Elo
 * update in place of the feed. `api.clubelo.com` stopped answering on 22 August 2026 and
 * published no replacement, so the base needed a new source rather than a new meaning.
 *
 * `npm run fit:elo-k` is what justifies letting real results move the rating at all: freeze
 * the base at each season's
 * opening rating, let drift be the only in-season update, and score the next matchday
 * walk-forward over five seasons. Drift is worth +0.0228 log-likelihood per match against a
 * frozen base with drift off (paired over 152 origins, SE 0.0059, t = 3.84), which recovers
 * essentially all of the 0.0226 the live clubelo feed was worth. Losing the feed costs
 * approximately nothing, provided real results reach the rating somehow — which they now do,
 * through the ratings step rather than through this weight.
 *
 * That sweep also declined to move two things. K = 25 nominally beats K = 20 but only at
 * t = 1.04, and scaling the update by winning margin is worth t = 0.04 — see
 * {@link movMultiplier}, which exists but stays off. Both are noise on five seasons.
 *
 * An earlier revision defaulted this weight to 0, on walk-forward evidence that drift was
 * neither significant (chi2(2) = 4.11, p = 0.13) nor useful (-0.00085 log-likelihood per match
 * over 152 origins). That measurement is still correct and still measures something else: it
 * let drift accumulate over real results *on top of* a base that already contained them, which
 * is the double-count this weight is scoped to avoid rather than a test of drift on its own.
 *
 * Drift also answers a second question — whether simulated *final tables* are as spread out as
 * real ones. Against the five completed seasons in `engine/src/fitting`, weight 0 is
 * under-dispersed: SD of points across the 20 clubs comes out at 16.0 against a historical
 * 18.0, about 3.2 standard errors low. Weight 1 closes half of that (17.0) at no cost to the
 * match-level fit — league H/D/A moves 44.2/22.3/33.5 to 43.8/22.5/33.7 and goals per match
 * 2.940 to 2.939, since drift is close to zero-sum and mostly reshuffles *which* fixtures are
 * mismatched. Weight 1.5 matches the historical dispersion almost exactly but is not the
 * default: part of the residual gap is clubelo's pre-season ratings being shrunk toward the
 * mean, and tuning drift to absorb that would be fitting a confound on five seasons.
 *
 * Weight 1 is therefore supported twice over: by final-table dispersion, and now by
 * out-of-sample per-match likelihood as well.
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

/**
 * How much the winning margin scales an Elo update.
 *
 * `none` is a pure 1/0.5/0 result: a 5-0 and a 1-0 move a rating identically. It is the
 * default, and the sweep in `npm run fit:elo-k` is why — scaling by margin is worth +0.00004
 * log-likelihood per match (SE 0.00082, t = 0.04), and the `linear` ladder measures slightly
 * worse than ignoring the margin altogether.
 *
 * That is less surprising than it first looks. The engine does not consume Elo directly: it
 * feeds a Poisson GLM on the rating gap, and the margin is already reaching the lambdas
 * through the training data. Scaling the Elo update re-encodes something the model has another
 * route to. The schemes are kept because the question is worth re-asking on more than five
 * seasons, not because either is currently switched on.
 *
 * - `linear` — the World Football Elo ladder: 1 up to a one-goal win, 1.5 at two, `(11+d)/8`
 *   beyond. Cheap and bounded, but the steps are asserted rather than fitted.
 * - `log` — `ln(d+1)`, damped by the favourite's rating edge. The damping is the important
 *   half: without it a strong club inflates by running up scores against weak ones, and the
 *   rating chases margin instead of strength.
 */
export type MovScheme = 'none' | 'linear' | 'log';

export const DEFAULT_MOV_SCHEME: MovScheme = 'none';

/**
 * Multiplier on the Elo update for a winning margin of `goalDiff`.
 *
 * `winnerEloEdge` is the winner's rating minus the loser's, *after* the result is known — so
 * it is positive when the favourite won and negative on an upset. The `log` damping divides
 * by that edge, which shrinks a favourite's gain for a rout and leaves an underdog's intact.
 */
export function movMultiplier(
  scheme: MovScheme,
  goalDiff: number,
  winnerEloEdge: number,
): number {
  const d = Math.abs(goalDiff);
  if (scheme === 'none' || d <= 1) return 1;

  if (scheme === 'linear') return d === 2 ? 1.5 : (11 + d) / 8;

  return Math.log(d + 1) * (2.2 / (0.001 * winnerEloEdge + 2.2));
}

export interface MatchEloDeltaOptions {
  k?: number;
  movScheme?: MovScheme;
}

export function matchEloDelta(
  homeElo: number,
  awayElo: number,
  goalsHome: number,
  goalsAway: number,
  k: number = DEFAULT_SEASON_ELO_K,
  options: Omit<MatchEloDeltaOptions, 'k'> = {},
): [number, number] {
  const { movScheme = DEFAULT_MOV_SCHEME } = options;

  const expectedHome = expectedScore(homeElo, awayElo);
  const actualHome = goalsHome > goalsAway ? 1 : goalsHome === goalsAway ? 0.5 : 0;

  // A draw has no winner to take the edge from, and `movMultiplier` returns 1 there anyway.
  const winnerEloEdge =
    goalsHome > goalsAway ? homeElo - awayElo : goalsAway > goalsHome ? awayElo - homeElo : 0;
  const scale = movMultiplier(movScheme, goalsHome - goalsAway, winnerEloEdge);

  const homeDelta = scale * k * (actualHome - expectedHome);
  const awayDelta = scale * k * (1 - actualHome - (1 - expectedHome));
  return [homeDelta, awayDelta];
}

export function computeEloDeltasFromMatches(
  teams: Team[] | Map<number, Team>,
  matches: EloMatchInput[],
  k: number = DEFAULT_SEASON_ELO_K,
  movScheme: MovScheme = DEFAULT_MOV_SCHEME,
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
      { movScheme },
    );
    deltas.set(home.id, (deltas.get(home.id) ?? 0) + homeDelta);
    deltas.set(away.id, (deltas.get(away.id) ?? 0) + awayDelta);
  }

  return deltas;
}
