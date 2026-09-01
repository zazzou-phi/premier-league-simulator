import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { MatchdayProjection, SeasonProjection } from '../types.js';

/**
 * The season read one matchweek at a time.
 *
 * A matchweek's projection is whichever batch that round is read through — matchweek 1 through
 * the batch that faced it blind, matchweek 2 through the one run the week after, and so on. So
 * stepping through the matchweeks is stepping through the forecast as it was actually made,
 * which is what makes a movement arrow between two of them mean anything.
 */
export interface MatchweekProjection {
  matchday: number;
  predictionId: number;
  /** The batch's name, as the Season tab's matchday headers show it. */
  name: string | null;
  runs: number;
  /** True when that batch forecast the round rather than being handed its results. */
  forecast: boolean;
  teams: TeamSeasonProjection[];
}

/**
 * The last matchweek worth showing: the round being played next, since every round after it
 * reads the same batch and would repeat that batch's table without adding a data point.
 * Once the season is complete the last round is the end of the line.
 */
export function lastProjectedMatchweek(
  matchdays: MatchdayProjection[],
  nextMatchday: number | null,
): number {
  const max = matchdays.reduce((highest, item) => Math.max(highest, item.matchday), 0);
  if (max === 0) return 0;
  return nextMatchday == null ? max : Math.min(nextMatchday, max);
}

/**
 * One entry per matchweek up to and including {@link lastProjectedMatchweek}, each carrying the
 * table its own batch projected. Matchweeks whose batch published no projection are dropped
 * rather than carried forward — a gap is honest, a repeated point is not.
 */
export function matchweekProjections(
  matchdays: MatchdayProjection[],
  seasonProjections: SeasonProjection[],
  nextMatchday: number | null,
): MatchweekProjection[] {
  const byId = new Map(seasonProjections.map((entry) => [entry.predictionId, entry]));
  const through = lastProjectedMatchweek(matchdays, nextMatchday);

  return matchdays
    .filter((item) => item.matchday <= through)
    .sort((a, b) => a.matchday - b.matchday)
    .flatMap((item) => {
      const projection = item.predictionId == null ? undefined : byId.get(item.predictionId);
      if (!projection) return [];
      return [
        {
          matchday: item.matchday,
          predictionId: projection.predictionId,
          name: item.name,
          runs: projection.runs,
          forecast: item.forecast,
          teams: projection.teams,
        } satisfies MatchweekProjection,
      ];
    });
}

/**
 * Where each club sits in the projected finishing order — mean finishing position, which is
 * what the table's default sort ranks on. Ties break the same way the table does, so the rank
 * a movement arrow is measured against is the rank the reader sees in the `#` column.
 */
export function projectedRanks(teams: TeamSeasonProjection[]): Map<number, number> {
  const ordered = [...teams].sort(
    (a, b) =>
      a.averagePosition - b.averagePosition ||
      b.averagePoints - a.averagePoints ||
      a.teamName.localeCompare(b.teamName),
  );
  return new Map(ordered.map((row, index) => [row.teamId, index + 1]));
}

/**
 * Places gained since the previous matchweek's projection — positive is upward, towards 1st.
 * Null for a club the earlier projection did not cover, which is not the same as no movement.
 */
export function rankMovement(
  current: Map<number, number>,
  previous: Map<number, number> | null,
): Map<number, number | null> {
  return new Map(
    [...current].map(([teamId, rank]) => {
      const before = previous?.get(teamId);
      return [teamId, before == null ? null : before - rank];
    }),
  );
}

/** Rank movement between two matchweeks' projections, ready for the table's arrow column. */
export function matchweekMovement(
  series: MatchweekProjection[],
  matchday: number,
): Map<number, number | null> {
  const index = series.findIndex((entry) => entry.matchday === matchday);
  if (index < 0) return new Map();
  const current = projectedRanks(series[index]!.teams);
  const previous = index > 0 ? projectedRanks(series[index - 1]!.teams) : null;
  return rankMovement(current, previous);
}
