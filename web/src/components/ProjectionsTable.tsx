import { useMemo } from 'react';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { formatProbability } from '../lib/formatProbability.js';
import {
  DEFAULT_PROJECTION_SORT,
  PROJECTION_COMPARATORS,
  type ProjectionSortKey,
} from '../lib/projectionSort.js';
import { teamsById } from '../lib/teamsById.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { MovementArrow } from './MovementArrow.js';
import { PositionAxis, PositionDistributionBar } from './PositionDistributionBar.js';
import { SortableTh } from './SortableTh.js';
import { TeamBadge } from './TeamBadge.js';

interface Props {
  projections: TeamSeasonProjection[];
  runs: number;
  teams?: Team[];
  showDistribution?: boolean;
  /**
   * Places gained on the previous matchweek's projection, keyed by club. Absent wherever there
   * is no earlier projection to move from — a single batch shown on its own has no movement.
   */
  movement?: Map<number, number | null>;
  /** Names what the movement is measured against, e.g. `since MW2`. */
  movementSince?: string;
}

function probabilityClass(value: number, danger = false): string {
  if (value === 0) return 'projections-pct-faint';
  if (value >= 0.25) return danger ? 'projections-pct-danger' : 'projections-pct-strong';
  return '';
}

export function ProjectionsTable({
  projections,
  runs,
  teams = [],
  showDistribution = true,
  movement,
  movementSince = 'since the previous matchweek',
}: Props) {
  const byId = useMemo(() => teamsById(teams), [teams]);

  const { sortedItems, sort, toggleSort } = useSortableTable<
    TeamSeasonProjection,
    ProjectionSortKey
  >(projections, DEFAULT_PROJECTION_SORT, PROJECTION_COMPARATORS);

  return (
    <div className="projections-table-wrap">
      <table className="projections-table">
        <thead>
          <tr>
            <th>#</th>
            {movement && (
              <th className="projections-movement" title={`Places gained ${movementSince}`}>
                <span aria-hidden="true">±</span>
                <span className="visually-hidden">Movement</span>
              </th>
            )}
            <SortableTh
              label="Team"
              sortKey="team"
              activeKey={sort.key}
              direction={sort.direction}
              className="projections-team"
              onSort={toggleSort}
            />
            <SortableTh
              label="Title"
              sortKey="title"
              activeKey={sort.key}
              direction={sort.direction}
              title="Share of seasons finishing 1st"
              onSort={toggleSort}
            />
            <SortableTh
              label="Top 4"
              sortKey="championsLeague"
              activeKey={sort.key}
              direction={sort.direction}
              title="Share of seasons finishing in a Champions League place"
              onSort={toggleSort}
            />
            <SortableTh
              label="Europe"
              sortKey="european"
              activeKey={sort.key}
              direction={sort.direction}
              title="Share of seasons finishing in the top 5"
              onSort={toggleSort}
            />
            <SortableTh
              label="Rel"
              sortKey="relegation"
              activeKey={sort.key}
              direction={sort.direction}
              title="Share of seasons finishing in a relegation place"
              onSort={toggleSort}
            />
            <SortableTh
              label="Avg Pts"
              sortKey="averagePoints"
              activeKey={sort.key}
              direction={sort.direction}
              title="Mean points across every simulated season"
              onSort={toggleSort}
            />
            <SortableTh
              label="Avg Pos"
              sortKey="averagePosition"
              activeKey={sort.key}
              direction={sort.direction}
              title="Mean finishing position across every simulated season"
              onSort={toggleSort}
            />
            <SortableTh
              label="GF"
              sortKey="averageGoalsFor"
              activeKey={sort.key}
              direction={sort.direction}
              title="Mean goals scored"
              onSort={toggleSort}
            />
            <SortableTh
              label="GA"
              sortKey="averageGoalsAgainst"
              activeKey={sort.key}
              direction={sort.direction}
              title="Mean goals conceded"
              onSort={toggleSort}
            />
            {showDistribution && (
              <th className="projections-distribution">
                <div className="projections-distribution-head">
                  <span>Finishing positions</span>
                  <PositionAxis />
                </div>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((row, index) => (
            <tr key={row.teamId}>
              <td>{index + 1}</td>
              {movement && (
                <td className="projections-movement">
                  <MovementArrow
                    places={movement.get(row.teamId)}
                    since={movementSince}
                    teamName={row.teamName}
                  />
                </td>
              )}
              <td className="projections-team">
                <TeamBadge
                  team={byId.get(row.teamId)}
                  teamName={row.teamName}
                  codeClassName="league-table-short"
                />
                {row.teamName}
              </td>
              <td className={probabilityClass(row.titleProbability)}>
                {formatProbability(row.titleProbability)}
              </td>
              <td className={probabilityClass(row.championsLeagueProbability)}>
                {formatProbability(row.championsLeagueProbability)}
              </td>
              <td className={probabilityClass(row.europeanProbability)}>
                {formatProbability(row.europeanProbability)}
              </td>
              <td className={probabilityClass(row.relegationProbability, true)}>
                {formatProbability(row.relegationProbability)}
              </td>
              <td>{row.averagePoints.toFixed(1)}</td>
              <td>{row.averagePosition.toFixed(2)}</td>
              <td>{row.averageGoalsFor.toFixed(1)}</td>
              <td>{row.averageGoalsAgainst.toFixed(1)}</td>
              {showDistribution && (
                <td className="projections-distribution">
                  <PositionDistributionBar
                    positionCounts={row.positionCounts}
                    runs={runs}
                    teamName={row.teamName}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
