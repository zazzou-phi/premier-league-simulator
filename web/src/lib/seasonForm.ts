import {
  DEFAULT_SEASON_ELO_DELTA_WEIGHT,
  SEASON_ELO_DELTA_WEIGHT_MAX,
} from '@shared/engine/seasonElo.js';

export { DEFAULT_SEASON_ELO_DELTA_WEIGHT, SEASON_ELO_DELTA_WEIGHT_MAX };

export const SEASON_FORM_HINT =
  'How strongly a simulated run of form moves a club off its current Club Elo rating. Results already played are in that rating, so only the simulated rest of the season moves it. 0 holds ratings fixed.';

export function formatSeasonEloDeltaWeight(value: number): string {
  return `${value.toFixed(2)}×`;
}
