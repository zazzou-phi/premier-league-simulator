import { useEffect, useMemo, useState } from 'react';
import type { Team } from '@shared/engine/types.js';
import { api } from '../api/client.js';
import { seriesColour, seriesDash, seriesSlots } from '../lib/seriesPalette.js';
import type { TeamEloSnapshot } from '../types.js';
import { ClubChartLegend } from './ClubChartLegend.js';
import { ClubLineChart, type ChartHover, type ClubSeries } from './ClubLineChart.js';

interface Props {
  teams: Team[];
  /**
   * Last day of football inside the matchweek being read, or null for the whole series. Dates
   * rather than a round number because the snapshots are keyed by the day results landed — see
   * `backfillEloHistory`, where a round with a postponement closes months after it opened.
   */
  throughDate: string | null;
  /** The matchweek that date belongs to, named in the panel's subtitle. */
  matchweek: number | null;
}

/** Snapshot dates are stored as wall-clock days, so they are sliced rather than parsed. */
function formatSnapshotDate(date: string): string {
  const [, month = '??', day = '??'] = date.split('-');
  return `${day}.${month}`;
}

/**
 * Where every club's rating has been, day by day.
 *
 * The series is history, not forecast: `fetch:ratings` prices in each real result, so a point
 * exists for every day football was played and nothing extends past today. That makes it the
 * one chart here whose x axis is dates rather than matchweeks — a round with a postponement
 * closes months after it opened, and a date names exactly what it contains.
 */
export function EloTrendChart({ teams, throughDate, matchweek }: Props) {
  const [history, setHistory] = useState<TeamEloSnapshot[] | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snapshots = await api.listEloHistory().catch(() => []);
      if (!cancelled) setHistory(snapshots);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { series, dates } = useMemo(() => {
    if (!history || history.length === 0) return { series: [] as ClubSeries[], dates: [] };

    // Cut at the matchweek the page is read through, so the ratings stop where the table does.
    const inCut =
      throughDate == null
        ? history
        : history.filter((snapshot) => snapshot.asOf <= throughDate);
    if (inCut.length === 0) return { series: [] as ClubSeries[], dates: [] };

    const dates = [...new Set(inCut.map((snapshot) => snapshot.asOf))].sort();
    const byTeam = new Map<number, Map<string, number>>();
    for (const snapshot of inCut) {
      let readings = byTeam.get(snapshot.teamId);
      if (!readings) {
        readings = new Map();
        byTeam.set(snapshot.teamId, readings);
      }
      readings.set(snapshot.asOf, snapshot.elo);
    }

    const slots = seriesSlots(teams.map((team) => team.id));
    // Strongest first, so the legend opens on the clubs a reader is looking for. Ranked on the
    // current rating rather than the last one inside the cut, which keeps the legend's order
    // steady as the matchweek moves.
    const series = [...teams]
      .filter((team) => byTeam.has(team.id))
      .sort((a, b) => b.elo - a.elo)
      .map((team) => {
        const slot = slots.get(team.id) ?? 0;
        const readings = byTeam.get(team.id)!;
        return {
          teamId: team.id,
          code: team.shortName,
          name: team.name,
          colour: seriesColour(slot),
          dash: seriesDash(slot),
          values: dates.map((date) => readings.get(date) ?? null),
        } satisfies ClubSeries;
      });

    return { series, dates };
  }, [history, teams, throughDate]);

  const xLabels = useMemo(() => dates.map(formatSnapshotDate), [dates]);

  const handleHover = (hover: ChartHover | null) => setHovered(hover?.teamId ?? null);

  return (
    <section className="chart-panel" aria-label="Elo ratings">
      <div className="chart-panel-head">
        <div>
          <h2 className="chart-panel-title">Elo ratings</h2>
          <p className="chart-panel-subtitle muted">
            Every club's rating on each day football was played
            {matchweek == null ? '' : `, up to and including matchweek ${matchweek}`}. The gap
            between two ratings is what sets the goal budget when they meet, so this is the input
            the projections above are built on — not an output of them.
          </p>
        </div>
      </div>

      <ClubLineChart
        series={series}
        xLabels={xLabels}
        xTitle="Date"
        yTitle="Elo rating"
        formatValue={(value) => value.toFixed(0)}
        active={pinned ?? hovered}
        onHover={handleHover}
        onPin={(teamId) => setPinned((prev) => (prev === teamId ? null : teamId))}
        emptyMessage={
          history == null
            ? 'Loading ratings history…'
            : history.length === 0
              ? 'No dated ratings yet — the series fills in as results are synced.'
              : 'No ratings were recorded this early in the season.'
        }
      />

      <ClubChartLegend
        series={series}
        pinned={pinned}
        hovered={hovered}
        onPin={setPinned}
        onHover={setHovered}
      />
    </section>
  );
}
