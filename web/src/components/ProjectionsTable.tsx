import { useMemo } from 'react';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { PositionDistributionBar } from './PositionDistributionBar.js';
import { SortableTh } from './SortableTh.js';

type SortKey =
  | 'team'
  | 'title'
  | 'championsLeague'
  | 'european'
  | 'relegation'
  | 'averagePoints'
  | 'averagePosition'
  | 'averageGoalsFor'
  | 'averageGoalsAgainst';

interface Props {
  projections: TeamSeasonProjection[];
  runs: number;
  teams?: Team[];
  showDistribution?: boolean;
}

function formatProbability(value: number): string {
  if (value === 0) return '—';
  if (value < 0.001) return '<0.1%';
  return `${(value * 100).toFixed(1)}%`;
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
}: Props) {
  const shortNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.shortName])),
    [teams],
  );

  const comparators = useMemo<
    Record<SortKey, (a: TeamSeasonProjection, b: TeamSeasonProjection) => number>
  >(
    () => ({
      team: (a, b) => a.teamName.localeCompare(b.teamName),
      title: (a, b) => a.titleProbability - b.titleProbability,
      championsLeague: (a, b) => a.championsLeagueProbability - b.championsLeagueProbability,
      european: (a, b) => a.europeanProbability - b.europeanProbability,
      relegation: (a, b) => a.relegationProbability - b.relegationProbability,
      averagePoints: (a, b) => a.averagePoints - b.averagePoints,
      averagePosition: (a, b) => a.averagePosition - b.averagePosition,
      averageGoalsFor: (a, b) => a.averageGoalsFor - b.averageGoalsFor,
      averageGoalsAgainst: (a, b) => a.averageGoalsAgainst - b.averageGoalsAgainst,
    }),
    [],
  );

  const { sortedItems, sort, toggleSort } = useSortableTable<TeamSeasonProjection, SortKey>(
    projections,
    { key: 'averagePosition', direction: 'asc' },
    comparators,
  );

  return (
    <div className="projections-table-wrap">
      <table className="projections-table">
        <thead>
          <tr>
            <th>#</th>
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
            {showDistribution && <th className="projections-distribution">Finishing positions</th>}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((row, index) => (
            <tr key={row.teamId}>
              <td>{index + 1}</td>
              <td className="projections-team">
                <span className="league-table-short">
                  {shortNameById.get(row.teamId) ?? ''}
                </span>
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
