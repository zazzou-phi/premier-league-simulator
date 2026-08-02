import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { ProjectionsTable } from './ProjectionsTable.js';

interface Props {
  projections: TeamSeasonProjection[];
  runs: number;
  teams: Team[];
  loading?: boolean;
}

export function ProjectionsView({ projections, runs, teams, loading = false }: Props) {
  return (
    <div className="projections-view">
      <div className="projections-panel">
        {loading ? (
          <p className="muted">Loading projections…</p>
        ) : projections.length === 0 ? (
          <p className="muted">No projection data available.</p>
        ) : (
          <ProjectionsTable projections={projections} runs={runs} teams={teams} />
        )}
      </div>
    </div>
  );
}
