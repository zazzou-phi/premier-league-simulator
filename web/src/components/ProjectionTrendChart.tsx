import { useMemo, useState } from 'react';
import type { Team } from '@shared/engine/types.js';
import type { MatchweekProjection } from '../lib/matchweekSeries.js';
import {
  DEFAULT_PROJECTION_METRIC,
  PROJECTION_METRICS,
  type ProjectionMetricKey,
} from '../lib/projectionMetrics.js';
import { seriesColour, seriesDash, seriesSlots } from '../lib/seriesPalette.js';
import { teamsById } from '../lib/teamsById.js';
import { ClubChartLegend } from './ClubChartLegend.js';
import { ClubLineChart, type ChartHover, type ClubSeries } from './ClubLineChart.js';

interface Props {
  /** One entry per matchweek, each holding what that week's own batch projected. */
  series: MatchweekProjection[];
  teams: Team[];
  /** The matchweek being read. The line stops here rather than running past it. */
  matchday: number;
}

/**
 * How the projected season has moved, matchweek by matchweek.
 *
 * Each point is a different Monte Carlo batch — the one that round is read through — so the
 * line is a record of the forecast changing as results landed, not one batch's opinion redrawn.
 * That is also why the series is short: it gains a point per matchweek played, not per fixture.
 */
export function ProjectionTrendChart({ series, teams, matchday }: Props) {
  const [metricKey, setMetricKey] = useState<ProjectionMetricKey>(DEFAULT_PROJECTION_METRIC.key);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const metric =
    PROJECTION_METRICS.find((item) => item.key === metricKey) ?? DEFAULT_PROJECTION_METRIC;

  const byId = useMemo(() => teamsById(teams), [teams]);

  // The chart reads as of the matchweek the page is set to, like everything above it: stepping
  // back winds the season back rather than leaving the line running on past the table.
  const shown = useMemo(
    () => series.filter((week) => week.matchday <= matchday),
    [series, matchday],
  );

  const chartSeries = useMemo<ClubSeries[]>(() => {
    if (shown.length === 0) return [];
    // Ordered by the matchweek being read, so the legend reads like the table beside it, while
    // the colours themselves come from the id order and stay put whatever the metric does.
    const latest = shown.at(-1)!;
    const slots = seriesSlots(latest.teams.map((row) => row.teamId));
    const valuesByTeam = shown.map(
      (week) => new Map(week.teams.map((row) => [row.teamId, metric.valueOf(row)])),
    );

    return latest.teams.map((row) => {
      const slot = slots.get(row.teamId) ?? 0;
      return {
        teamId: row.teamId,
        code: byId.get(row.teamId)?.shortName ?? row.teamName.slice(0, 3).toUpperCase(),
        name: row.teamName,
        colour: seriesColour(slot),
        dash: seriesDash(slot),
        values: valuesByTeam.map((week) => week.get(row.teamId) ?? null),
      } satisfies ClubSeries;
    });
  }, [shown, metric, byId]);

  const xLabels = useMemo(() => shown.map((week) => `MW${week.matchday}`), [shown]);

  const handleHover = (hover: ChartHover | null) => setHovered(hover?.teamId ?? null);

  return (
    <section className="chart-panel" aria-label="Projection trend">
      <div className="chart-panel-head">
        <div>
          <h2 className="chart-panel-title">Projection by matchweek</h2>
          <p className="chart-panel-subtitle muted">
            {metric.hint} One point per matchweek up to MW{matchday}, each from the simulation
            that week is read through.
          </p>
        </div>
        <div className="chart-metric-toggle" role="group" aria-label="Measure">
          {PROJECTION_METRICS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`btn btn-ghost btn-small ${option.key === metricKey ? 'active' : ''}`}
              aria-pressed={option.key === metricKey}
              onClick={() => setMetricKey(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <ClubLineChart
        series={chartSeries}
        xLabels={xLabels}
        xTitle="Matchweek"
        yTitle={metric.axis}
        invertY={metric.invert}
        yDomain={metric.domain}
        formatValue={metric.format}
        active={pinned ?? hovered}
        onHover={handleHover}
        onPin={(teamId) => setPinned((prev) => (prev === teamId ? null : teamId))}
        emptyMessage="No matchweek has a projection behind it yet."
      />

      <ClubChartLegend
        series={chartSeries}
        pinned={pinned}
        hovered={hovered}
        onPin={setPinned}
        onHover={setHovered}
      />
    </section>
  );
}
