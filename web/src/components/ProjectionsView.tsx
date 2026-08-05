import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { PROJECTIONS_CARDS_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { ProjectionCardList } from './ProjectionCardList.js';
import { ProjectionHeadline } from './ProjectionHeadline.js';
import { ProjectionsTable } from './ProjectionsTable.js';
import { ZoneLegend } from './ZoneLegend.js';

interface Props {
  projections: TeamSeasonProjection[];
  runs: number;
  teams: Team[];
  /** Lowest matchday still unplayed, or null once the season is complete. */
  nextMatchday: number | null;
  loading?: boolean;
}

export function ProjectionsView({
  projections,
  runs,
  teams,
  nextMatchday,
  loading = false,
}: Props) {
  // Branches here rather than inside ProjectionsTable, which MonteCarloModal also renders with
  // showDistribution={false} — cards built around the distribution bar make no sense there.
  // Switch at 900px, where the table drops its distribution column, so the cards (which keep
  // the distribution) take over exactly there rather than leaving a gap down to 640px.
  const narrow = useMediaQuery(PROJECTIONS_CARDS_QUERY);

  return (
    <div className="projections-view">
      <div className="projections-panel">
        {loading ? (
          <p className="muted">Loading projections…</p>
        ) : projections.length === 0 ? (
          <p className="muted">No projection data available.</p>
        ) : (
          <>
            <ProjectionHeadline
              projections={projections}
              runs={runs}
              nextMatchday={nextMatchday}
              teams={teams}
            />
            {/* The distribution bars are entirely colour-encoded, so this view needs the
                key at least as much as the tables do. */}
            <ZoneLegend />
            {narrow ? (
              <ProjectionCardList projections={projections} runs={runs} teams={teams} />
            ) : (
              <ProjectionsTable projections={projections} runs={runs} teams={teams} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
