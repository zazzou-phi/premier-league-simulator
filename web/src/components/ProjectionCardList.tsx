import { useMemo, useState } from 'react';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { formatProbability } from '../lib/formatProbability.js';
import { PROJECTION_COMPARATORS, PROJECTION_SORT_OPTIONS } from '../lib/projectionSort.js';
import { teamsById } from '../lib/teamsById.js';
import { PositionAxis, PositionDistributionBar } from './PositionDistributionBar.js';
import { TeamBadge } from './TeamBadge.js';

interface Props {
  projections: TeamSeasonProjection[];
  runs: number;
  teams?: Team[];
}

/**
 * Narrow-viewport substitute for `ProjectionsTable`. The table's ten columns force a horizontal
 * scroll below 640px that pushes the finishing-position distribution — the most valuable thing on
 * the screen — off the viewport entirely. One card per club reflows instead.
 */
export function ProjectionCardList({ projections, runs, teams = [] }: Props) {
  const [optionValue, setOptionValue] = useState(PROJECTION_SORT_OPTIONS[0]!.value);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const byId = useMemo(() => teamsById(teams), [teams]);

  const selected =
    PROJECTION_SORT_OPTIONS.find((option) => option.value === optionValue) ??
    PROJECTION_SORT_OPTIONS[0]!;

  // Not `useSortableTable`: that hook models click-to-toggle headers, while a select carries its
  // own direction per option and has no second click to reverse with.
  const rows = useMemo(() => {
    const compare = PROJECTION_COMPARATORS[selected.sort.key];
    const direction = selected.sort.direction === 'asc' ? 1 : -1;
    return [...projections].sort((a, b) => direction * compare(a, b));
  }, [projections, selected]);

  const toggle = (teamId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  return (
    <div className="projection-cards-wrap">
      <div className="projection-cards-sort">
        <label htmlFor="projection-sort">Sort by</label>
        <select
          id="projection-sort"
          value={optionValue}
          onChange={(e) => setOptionValue(e.target.value)}
        >
          {PROJECTION_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* One axis for the whole list: the per-card bars share it, so a club's spread can be
          read against the same 1–20 scale without a ruler under every card. */}
      <div className="projection-cards-axis">
        <span className="projection-cards-axis-label">Finishing positions</span>
        <PositionAxis />
      </div>

      <ol className="projection-cards">
        {rows.map((row, index) => {
          const open = expanded.has(row.teamId);
          return (
            <li key={row.teamId} className="projection-card">
              <div className="projection-card-head">
                <span className="projection-card-rank">{index + 1}</span>
                <span className="projection-card-team">
                  <TeamBadge
                    team={byId.get(row.teamId)}
                    teamName={row.teamName}
                    codeClassName="league-table-short"
                  />
                  {row.teamName}
                </span>
              </div>

              <PositionDistributionBar
                positionCounts={row.positionCounts}
                runs={runs}
                teamName={row.teamName}
              />

              <dl className="projection-card-figures">
                <div className="projection-card-figure">
                  <dt>Title</dt>
                  <dd>{formatProbability(row.titleProbability)}</dd>
                </div>
                <div className="projection-card-figure">
                  <dt>Top 4</dt>
                  <dd>{formatProbability(row.championsLeagueProbability)}</dd>
                </div>
                <div className="projection-card-figure projection-card-figure-danger">
                  <dt>Rel</dt>
                  <dd>{formatProbability(row.relegationProbability)}</dd>
                </div>
              </dl>

              <button
                type="button"
                className="btn btn-ghost projection-card-toggle"
                aria-expanded={open}
                onClick={() => toggle(row.teamId)}
              >
                {open ? 'Hide detail' : 'Show detail'}
              </button>

              {open && (
                <dl className="projection-card-detail">
                  <div className="projection-card-figure">
                    <dt>Avg Pts</dt>
                    <dd>{row.averagePoints.toFixed(1)}</dd>
                  </div>
                  <div className="projection-card-figure">
                    <dt>Avg Pos</dt>
                    <dd>{row.averagePosition.toFixed(2)}</dd>
                  </div>
                  <div className="projection-card-figure">
                    <dt>GF</dt>
                    <dd>{row.averageGoalsFor.toFixed(1)}</dd>
                  </div>
                  <div className="projection-card-figure">
                    <dt>GA</dt>
                    <dd>{row.averageGoalsAgainst.toFixed(1)}</dd>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
