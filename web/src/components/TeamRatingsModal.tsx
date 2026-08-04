import { useEffect, useMemo, useState } from 'react';
import type { Team } from '@shared/engine/types.js';
import { api } from '../api/client.js';
import {
  ELO_MOVE_THRESHOLD,
  formatEloDelta,
  groupEloSeries,
  type TeamEloSeries,
} from '../lib/eloSeries.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { Modal } from './Modal.js';
import { SortableTh } from './SortableTh.js';
import { Sparkline } from './Sparkline.js';

interface Props {
  teams: Team[];
  onClose: () => void;
}

type RatingsSortKey = 'code' | 'team' | 'elo' | 'change';

/** Direction colour rides the number, which also carries an explicit sign. */
function deltaDirection(delta: number | null | undefined): 'up' | 'down' | 'flat' {
  if (delta == null || Math.abs(delta) < ELO_MOVE_THRESHOLD) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

function deltaClass(delta: number | null | undefined): string {
  const direction = deltaDirection(delta);
  if (direction === 'flat') return 'muted';
  return direction === 'up' ? 'accuracy-good' : 'accuracy-bad';
}

export function TeamRatingsModal({ teams, onClose }: Props) {
  const [series, setSeries] = useState<Map<number, TeamEloSeries>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const history = await api.listEloHistory();
        if (!cancelled) setSeries(groupEloSeries(history));
      } catch {
        // No history yet (or public snapshot predates it) — the modal still shows ratings.
        if (!cancelled) setSeries(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const deltaOf = (team: Team) => series.get(team.id)?.delta ?? 0;

  const comparators = useMemo<Record<RatingsSortKey, (a: Team, b: Team) => number>>(
    () => ({
      code: (a, b) => a.shortName.localeCompare(b.shortName),
      team: (a, b) => a.name.localeCompare(b.name),
      elo: (a, b) => a.elo - b.elo || a.name.localeCompare(b.name),
      change: (a, b) => deltaOf(a) - deltaOf(b) || a.name.localeCompare(b.name),
    }),
    [series],
  );

  const { sortedItems, sort, toggleSort } = useSortableTable<Team, RatingsSortKey>(
    teams,
    { key: 'elo', direction: 'desc' },
    comparators,
  );

  return (
    <Modal className="modal modal-wide" titleId="team-ratings-title" onClose={onClose}>
      <h2 id="team-ratings-title">Team ratings</h2>
      <p className="muted ratings-modal-hint">
        Club Elo from clubelo.com. When two teams meet, the Elo gap sets how the match
        goal budget is split — not separate attack and defence multipliers. Change and
        trend come from the dated snapshots each weekly sync records.
      </p>

      <div className="ratings-table-wrap">
        <table className="ratings-table">
          <thead>
            <tr>
              <SortableTh
                label="Code"
                sortKey="code"
                activeKey={sort.key}
                direction={sort.direction}
                onSort={toggleSort}
              />
              <SortableTh
                label="Team"
                sortKey="team"
                activeKey={sort.key}
                direction={sort.direction}
                onSort={toggleSort}
              />
              <SortableTh
                label="Elo"
                sortKey="elo"
                activeKey={sort.key}
                direction={sort.direction}
                className="ratings-table-numeric"
                onSort={toggleSort}
              />
              <SortableTh
                label="Change"
                sortKey="change"
                activeKey={sort.key}
                direction={sort.direction}
                className="ratings-table-numeric"
                onSort={toggleSort}
              />
              <th className="ratings-table-numeric">Trend</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((team) => (
              <tr key={team.id}>
                <td>{team.shortName}</td>
                <td>{team.name}</td>
                <td className="ratings-table-numeric ratings-active-col">
                  {Math.round(team.elo)}
                </td>
                <td className={`ratings-table-numeric ${deltaClass(series.get(team.id)?.delta)}`}>
                  {formatEloDelta(series.get(team.id)?.delta ?? null)}
                </td>
                <td className="ratings-table-numeric">
                  <Sparkline
                    values={series.get(team.id)?.values ?? []}
                    label={`${team.name} Elo trend`}
                    latestDirection={deltaDirection(series.get(team.id)?.delta)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
