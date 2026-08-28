import type { MatchdayProjection } from '../types.js';

/**
 * A matchday is read through one projection: the batch that supplies its picks and the spread
 * behind them. Unpinned rounds resolve server-side to the last batch that faced them blind, so
 * a finished round keeps the odds it was actually up against.
 */

export function projectionsByMatchday(
  projections: MatchdayProjection[],
): Map<number, MatchdayProjection> {
  return new Map(projections.map((projection) => [projection.matchday, projection]));
}

/** The batch a fixture's picks and distribution come from, or null before any batch has run. */
export function predictionIdForMatchday(
  projections: MatchdayProjection[],
  matchday: number,
): number | null {
  return projections.find((item) => item.matchday === matchday)?.predictionId ?? null;
}

/** Every distinct batch the season is currently read through, in matchday order. */
export function assignedPredictionIds(projections: MatchdayProjection[]): number[] {
  return [
    ...new Set(
      projections.flatMap((item) => (item.predictionId == null ? [] : [item.predictionId])),
    ),
  ];
}
