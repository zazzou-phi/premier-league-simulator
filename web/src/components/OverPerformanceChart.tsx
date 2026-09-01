import { useMemo } from 'react';
import type { StandingRow } from '@shared/engine/types.js';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import { projectedRanks } from '../lib/matchweekSeries.js';
import { DivergingBars, type DivergingPoint } from './Sparkline.js';

interface Props {
  /** The real table as it stands at the matchweek being read. */
  standings: StandingRow[];
  projections: TeamSeasonProjection[];
  matchweek: number;
  /** Real fixtures behind the table; below a couple of rounds the gap is mostly noise. */
  playedMatches: number;
}

/** Two rounds is the point at which a table stops being a coin-toss ordering. */
const MIN_PLAYED_MATCHES = 20;

/**
 * Who the table is flattering, and who it is punishing.
 *
 * The bar is the gap between where a club sits now and where this matchweek's simulation
 * expects it to finish: up means the table has it higher than the model does, which by the
 * model's reckoning is a club with regression coming. It is a polarity question — better off
 * or worse off than projected — so the encoding is diverging around a zero line, and clubs the
 * model already agrees with sit flat rather than drawing attention.
 */
export function OverPerformanceChart({
  standings,
  projections,
  matchweek,
  playedMatches,
}: Props) {
  const points = useMemo<DivergingPoint[]>(() => {
    const ranks = projectedRanks(projections);
    return standings
      .flatMap((row) => {
        const projected = ranks.get(row.teamId);
        if (projected == null) return [];
        const gap = projected - row.position;
        return [
          {
            key: row.teamId,
            label: row.team.shortName,
            value: gap,
            tooltip:
              gap === 0
                ? `${row.team.name} · ${row.position} in the table, projected to finish ${projected}`
                : `${row.team.name} · ${row.position} in the table, projected to finish ${projected} — ${Math.abs(gap)} ${
                    Math.abs(gap) === 1 ? 'place' : 'places'
                  } ${gap > 0 ? 'better off than projected' : 'worse off than projected'}`,
          } satisfies DivergingPoint,
        ];
      })
      .sort((a, b) => b.value - a.value);
  }, [standings, projections]);

  if (playedMatches < MIN_PLAYED_MATCHES || points.length === 0) return null;

  return (
    <section className="chart-panel" aria-label="Table against projection">
      <div className="chart-panel-head">
        <div>
          <h2 className="chart-panel-title">Table against projection</h2>
          <p className="chart-panel-subtitle muted">
            Places between where each club sits after {playedMatches} played{' '}
            {playedMatches === 1 ? 'match' : 'matches'} and where matchweek {matchweek}'s
            simulation projects it to finish. Above the line is a club the table currently
            flatters; below it, one the model rates higher than its results do.
          </p>
        </div>
      </div>
      <DivergingBars
        points={points}
        height={280}
        caption="Places better off (above) or worse off (below) in the table than projected to finish"
      />
    </section>
  );
}
