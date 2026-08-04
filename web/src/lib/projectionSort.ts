import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { SortState } from './useSortableTable.js';

/** Shared by the desktop table's column headers and the mobile card list's sort select. */
export type ProjectionSortKey =
  | 'team'
  | 'title'
  | 'championsLeague'
  | 'european'
  | 'relegation'
  | 'averagePoints'
  | 'averagePosition'
  | 'averageGoalsFor'
  | 'averageGoalsAgainst';

export const PROJECTION_COMPARATORS: Record<
  ProjectionSortKey,
  (a: TeamSeasonProjection, b: TeamSeasonProjection) => number
> = {
  team: (a, b) => a.teamName.localeCompare(b.teamName),
  title: (a, b) => a.titleProbability - b.titleProbability,
  championsLeague: (a, b) => a.championsLeagueProbability - b.championsLeagueProbability,
  european: (a, b) => a.europeanProbability - b.europeanProbability,
  relegation: (a, b) => a.relegationProbability - b.relegationProbability,
  averagePoints: (a, b) => a.averagePoints - b.averagePoints,
  averagePosition: (a, b) => a.averagePosition - b.averagePosition,
  averageGoalsFor: (a, b) => a.averageGoalsFor - b.averageGoalsFor,
  averageGoalsAgainst: (a, b) => a.averageGoalsAgainst - b.averageGoalsAgainst,
};

export const DEFAULT_PROJECTION_SORT: SortState<ProjectionSortKey> = {
  key: 'averagePosition',
  direction: 'asc',
};

/**
 * Card-list sort choices, each pinned to the direction that puts the interesting end first —
 * a select has no second click to reverse with.
 */
export const PROJECTION_SORT_OPTIONS: Array<{
  value: string;
  label: string;
  sort: SortState<ProjectionSortKey>;
}> = [
  { value: 'position', label: 'Projected position', sort: DEFAULT_PROJECTION_SORT },
  { value: 'title', label: 'Title odds', sort: { key: 'title', direction: 'desc' } },
  { value: 'top4', label: 'Top 4 odds', sort: { key: 'championsLeague', direction: 'desc' } },
  { value: 'relegation', label: 'Relegation risk', sort: { key: 'relegation', direction: 'desc' } },
  { value: 'points', label: 'Average points', sort: { key: 'averagePoints', direction: 'desc' } },
  { value: 'team', label: 'Team name', sort: { key: 'team', direction: 'asc' } },
];
