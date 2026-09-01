import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';

export type ProjectionMetricKey =
  | 'position'
  | 'title'
  | 'championsLeague'
  | 'european'
  | 'relegation';

export interface ProjectionMetric {
  key: ProjectionMetricKey;
  label: string;
  /** Names the y axis, and the measure the tooltip is quoting. */
  axis: string;
  valueOf: (row: TeamSeasonProjection) => number;
  format: (value: number) => string;
  /** Fixed for a ranking, which is always 1–20 whatever this week's numbers happen to be. */
  domain?: [number, number];
  /** True where 1 belongs at the top of the chart. */
  invert?: boolean;
  hint: string;
}

/** Trimmed to one decimal, so an axis tick reads `10` and a club's mean reads `10.4`. */
function formatPosition(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * Probabilities on an axis, not in a cell: unlike {@link formatProbability} a zero here is a
 * real coordinate on the scale rather than an impossible outcome, so it prints as `0%`.
 */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value < 0.1 && value > 0 ? 1 : 0)}%`;
}

export const PROJECTION_METRICS: ProjectionMetric[] = [
  {
    key: 'position',
    label: 'Projected finish',
    axis: 'Mean finishing position',
    valueOf: (row) => row.averagePosition,
    format: formatPosition,
    domain: [1, 20],
    invert: true,
    hint: 'Mean finishing position across every simulated season, so a line rising towards the top of the chart is a club the model is warming to.',
  },
  {
    key: 'title',
    label: 'Title',
    axis: 'Title probability',
    valueOf: (row) => row.titleProbability,
    format: formatPercent,
    hint: 'Share of simulated seasons finishing 1st.',
  },
  {
    key: 'championsLeague',
    label: 'Top 4',
    axis: 'Top four probability',
    valueOf: (row) => row.championsLeagueProbability,
    format: formatPercent,
    hint: 'Share of simulated seasons finishing in a Champions League place.',
  },
  {
    key: 'european',
    label: 'Europe',
    axis: 'European probability',
    valueOf: (row) => row.europeanProbability,
    format: formatPercent,
    hint: 'Share of simulated seasons finishing in the top five.',
  },
  {
    key: 'relegation',
    label: 'Relegation',
    axis: 'Relegation probability',
    valueOf: (row) => row.relegationProbability,
    format: formatPercent,
    hint: 'Share of simulated seasons finishing in a relegation place.',
  },
];

export const DEFAULT_PROJECTION_METRIC = PROJECTION_METRICS[0]!;
