import { useMemo } from 'react';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { teamsById } from '../lib/teamsById.js';
import { MovementArrow } from './MovementArrow.js';
import { TeamBadge } from './TeamBadge.js';

interface Props {
  projections: TeamSeasonProjection[];
  /** Places gained since the previous matchweek's projection, keyed by club. */
  movement: Map<number, number | null>;
  teams: Team[];
  /** The matchweek this is measured against, named in the heading. */
  previousMatchweek: number | null;
}

/** Three each way is enough to say what moved without becoming a second table. */
const PER_SIDE = 3;

/**
 * What the week's new simulation changed its mind about.
 *
 * The table below carries the same arrows, but a reader scanning twenty rows for the two that
 * moved is doing the chart's job by hand. Clubs that did not move at all are left out — a strip
 * of dashes says nothing.
 */
export function ProjectionMovers({ projections, movement, teams, previousMatchweek }: Props) {
  const byId = useMemo(() => teamsById(teams), [teams]);

  const { risers, fallers } = useMemo(() => {
    const moved = projections
      .map((row) => ({ row, places: movement.get(row.teamId) ?? null }))
      .filter((entry): entry is { row: TeamSeasonProjection; places: number } =>
        entry.places != null && entry.places !== 0,
      );
    return {
      risers: moved
        .filter((entry) => entry.places > 0)
        .sort((a, b) => b.places - a.places)
        .slice(0, PER_SIDE),
      fallers: moved
        .filter((entry) => entry.places < 0)
        .sort((a, b) => a.places - b.places)
        .slice(0, PER_SIDE),
    };
  }, [projections, movement]);

  if (previousMatchweek == null) return null;

  const since = `since MW${previousMatchweek}`;

  return (
    <section className="movers" aria-label="Biggest movers">
      <h2 className="movers-heading">
        Biggest movers <span className="muted">{since}</span>
      </h2>
      {risers.length === 0 && fallers.length === 0 ? (
        <p className="muted movers-empty">
          No club changed its projected finishing place {since}.
        </p>
      ) : (
        <div className="movers-groups">
          {[
            { key: 'up', label: 'Rising', entries: risers },
            { key: 'down', label: 'Falling', entries: fallers },
          ].map((group) => (
            <div key={group.key} className={`movers-group movers-group-${group.key}`}>
              <span className="movers-group-label muted">{group.label}</span>
              {group.entries.length === 0 ? (
                <span className="muted movers-empty">none</span>
              ) : (
                <ul className="movers-list">
                  {group.entries.map(({ row, places }) => (
                    <li key={row.teamId} className="movers-item">
                      <TeamBadge
                        team={byId.get(row.teamId)}
                        teamName={row.teamName}
                        codeClassName="league-table-short"
                      />
                      <span className="movers-team">{row.teamName}</span>
                      <MovementArrow places={places} since={since} teamName={row.teamName} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
