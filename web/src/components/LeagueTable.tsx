import { useMemo, type ReactNode } from 'react';
import { zoneForPosition } from '@shared/engine/standings.js';
import type { StandingRow } from '@shared/engine/types.js';
import { ZONE_LABELS } from '../lib/leagueZones.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { SortableTh } from './SortableTh.js';
import { TeamBadge } from './TeamBadge.js';
import { ZoneLegend } from './ZoneLegend.js';

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
  /** One line stating where the numbers come from. Projected and actual must not be confusable. */
  subtitle?: string;
  /** Colours the panel header. `actual` marks a record of what happened, not a forecast. */
  tone?: 'projected' | 'actual';
  matchesPlayed?: number;
  matchesTotal?: number;
  /** Controls belonging to this table, rendered in the title row. */
  titleActions?: ReactNode;
  /** Rendered instead of the table and legend — an all-zero table is not worth showing. */
  emptyState?: ReactNode;
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
  subtitle,
  tone = 'projected',
  matchesPlayed,
  matchesTotal,
  titleActions,
  emptyState,
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

  const header = (
    <div className={`league-table-header league-table-header-${tone}`}>
      <div className="league-table-title">
        <h2 className="league-table-heading">{title}</h2>
        {matchesPlayed != null && matchesTotal != null && (
          <span className="league-table-progress">
            {matchesPlayed === 0 ? 'No matches played yet' : `${matchesPlayed}/${matchesTotal} played`}
          </span>
        )}
        <ZoneLegend />
        {titleActions}
      </div>
      {subtitle && <p className="league-table-subtitle">{subtitle}</p>}
    </div>
  );

  if (emptyState) {
    return (
      <div className="league-table">
        {header}
        {emptyState}
      </div>
    );
  }

  return (
    <div className="league-table">
      {header}
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
            const selected = row.teamId === selectedTeamId;
            const classes = [
              `zone-${zone}`,
              selected ? 'team-selected' : '',
              onSelectTeam ? 'team-selectable' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const teamCell = (
              <>
                <TeamBadge
                  team={row.team}
                  teamName={row.team.name}
                  codeClassName="league-table-short"
                />
                {row.team.name}
              </>
            );

            return (
              <tr key={row.teamId} className={classes} title={`${row.team.name} · ${ZONE_LABELS[zone]}`}>
                <td className="league-table-position">{row.position}</td>
                <td className="league-table-team">
                  {onSelectTeam ? (
                    // A button, not a row click handler: filtering has to work from the keyboard.
                    <button
                      type="button"
                      className="league-table-team-btn"
                      aria-pressed={selected}
                      title={
                        selected
                          ? `Clear the fixture filter for ${row.team.name}`
                          : `Filter fixtures to ${row.team.name}`
                      }
                      onClick={() => onSelectTeam(row.teamId)}
                    >
                      {teamCell}
                      <span className="league-table-filter-glyph" aria-hidden="true">
                        ⌕
                      </span>
                    </button>
                  ) : (
                    teamCell
                  )}
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
    </div>
  );
}
