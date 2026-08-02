import { useMemo } from 'react';
import { zoneForPosition } from '@shared/engine/standings.js';
import type { StandingRow } from '@shared/engine/types.js';
import { LEGEND_ZONES, ZONE_LABELS } from '../lib/leagueZones.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { SortableTh } from './SortableTh.js';

type SortKey =
  | 'position'
  | 'team'
  | 'played'
  | 'won'
  | 'drawn'
  | 'lost'
  | 'goalsFor'
  | 'goalsAgainst'
  | 'goalDifference'
  | 'points';

interface Props {
  standings: StandingRow[];
  title?: string;
  matchesPlayed?: number;
  matchesTotal?: number;
  selectedTeamId?: number | null;
  onSelectTeam?: (teamId: number) => void;
}

function goalDifferenceClass(goalDifference: number): string | undefined {
  if (goalDifference > 0) return 'league-table-gd-positive';
  if (goalDifference < 0) return 'league-table-gd-negative';
  return undefined;
}

function formatGoalDifference(goalDifference: number): string {
  return goalDifference > 0 ? `+${goalDifference}` : String(goalDifference);
}

export function LeagueTable({
  standings,
  title = 'Table',
  matchesPlayed,
  matchesTotal,
  selectedTeamId = null,
  onSelectTeam,
}: Props) {
  const comparators = useMemo<Record<SortKey, (a: StandingRow, b: StandingRow) => number>>(
    () => ({
      position: (a, b) => a.position - b.position,
      team: (a, b) => a.team.name.localeCompare(b.team.name),
      played: (a, b) => a.played - b.played || a.position - b.position,
      won: (a, b) => a.won - b.won || a.position - b.position,
      drawn: (a, b) => a.drawn - b.drawn || a.position - b.position,
      lost: (a, b) => a.lost - b.lost || a.position - b.position,
      goalsFor: (a, b) => a.goalsFor - b.goalsFor || a.position - b.position,
      goalsAgainst: (a, b) => a.goalsAgainst - b.goalsAgainst || a.position - b.position,
      goalDifference: (a, b) => a.goalDifference - b.goalDifference || a.position - b.position,
      points: (a, b) => a.points - b.points || a.position - b.position,
    }),
    [],
  );

  const { sortedItems, sort, toggleSort } = useSortableTable<StandingRow, SortKey>(
    standings,
    { key: 'position', direction: 'asc' },
    comparators,
  );

  const teamCount = standings.length;

  return (
    <div className="league-table">
      <div className="league-table-title">
        <span>{title}</span>
        {matchesPlayed != null && matchesTotal != null && (
          <span className="league-table-progress">
            {matchesPlayed}/{matchesTotal} played
          </span>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh
              label="#"
              sortKey="position"
              activeKey={sort.key}
              direction={sort.direction}
              onSort={toggleSort}
            />
            <SortableTh
              label="Team"
              sortKey="team"
              activeKey={sort.key}
              direction={sort.direction}
              className="league-table-team"
              onSort={toggleSort}
            />
            <SortableTh
              label="P"
              sortKey="played"
              activeKey={sort.key}
              direction={sort.direction}
              title="Played"
              onSort={toggleSort}
            />
            <SortableTh
              label="W"
              sortKey="won"
              activeKey={sort.key}
              direction={sort.direction}
              title="Won"
              onSort={toggleSort}
            />
            <SortableTh
              label="D"
              sortKey="drawn"
              activeKey={sort.key}
              direction={sort.direction}
              title="Drawn"
              onSort={toggleSort}
            />
            <SortableTh
              label="L"
              sortKey="lost"
              activeKey={sort.key}
              direction={sort.direction}
              title="Lost"
              onSort={toggleSort}
            />
            <SortableTh
              label="GF"
              sortKey="goalsFor"
              activeKey={sort.key}
              direction={sort.direction}
              title="Goals for"
              onSort={toggleSort}
            />
            <SortableTh
              label="GA"
              sortKey="goalsAgainst"
              activeKey={sort.key}
              direction={sort.direction}
              title="Goals against"
              onSort={toggleSort}
            />
            <SortableTh
              label="GD"
              sortKey="goalDifference"
              activeKey={sort.key}
              direction={sort.direction}
              title="Goal difference"
              onSort={toggleSort}
            />
            <SortableTh
              label="Pts"
              sortKey="points"
              activeKey={sort.key}
              direction={sort.direction}
              title="Points"
              onSort={toggleSort}
            />
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((row) => {
            const zone = zoneForPosition(row.position, teamCount);
            const classes = [
              `zone-${zone}`,
              row.teamId === selectedTeamId ? 'team-selected' : '',
              onSelectTeam ? 'team-selectable' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <tr
                key={row.teamId}
                className={classes}
                title={`${row.team.name} · ${ZONE_LABELS[zone]}`}
                onClick={onSelectTeam ? () => onSelectTeam(row.teamId) : undefined}
              >
                <td className="league-table-position">{row.position}</td>
                <td className="league-table-team">
                  <span className="league-table-short">{row.team.shortName}</span>
                  {row.team.name}
                </td>
                <td>{row.played}</td>
                <td>{row.won}</td>
                <td>{row.drawn}</td>
                <td>{row.lost}</td>
                <td>{row.goalsFor}</td>
                <td>{row.goalsAgainst}</td>
                <td className={goalDifferenceClass(row.goalDifference)}>
                  {formatGoalDifference(row.goalDifference)}
                </td>
                <td className="league-table-points">{row.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="zone-legend">
        {LEGEND_ZONES.map((zone) => (
          <span key={zone} className="zone-legend-item">
            <span className={`zone-legend-swatch zone-legend-swatch-${zone}`} />
            {ZONE_LABELS[zone]}
          </span>
        ))}
      </div>
    </div>
  );
}
