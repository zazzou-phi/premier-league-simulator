import {
  DEFAULT_SEASON_ELO_DELTA_WEIGHT,
  SEASON_ELO_DELTA_WEIGHT_MAX,
} from '@shared/engine/seasonElo.js';

export { DEFAULT_SEASON_ELO_DELTA_WEIGHT, SEASON_ELO_DELTA_WEIGHT_MAX };

export const SEASON_FORM_HINT =
  'How strongly results already played drag a team away from its starting Elo. 0 keeps pre-season ratings fixed all year; higher values let a hot or cold run compound.';

export function formatSeasonEloDeltaWeight(value: number): string {
  return `${value.toFixed(2)}×`;
}
