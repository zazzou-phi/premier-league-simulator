import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { ProjectionCardList } from './ProjectionCardList.js';
import { ProjectionHeadline } from './ProjectionHeadline.js';
import { ProjectionsTable } from './ProjectionsTable.js';

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
  const narrow = useMediaQuery(MOBILE_QUERY);

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
