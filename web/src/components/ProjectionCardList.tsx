import { useMemo, useRef, useState } from 'react';
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

/** The nearest ancestor that actually scrolls, which is the panel below 900px and the wrap above. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Narrow-viewport substitute for `ProjectionsTable`. The table's ten columns force a horizontal
 * scroll below 640px that pushes the finishing-position distribution — the most valuable thing on
 * the screen — off the viewport entirely. One card per club reflows instead.
 */
export function ProjectionCardList({ projections, runs, teams = [] }: Props) {
  const [optionValue, setOptionValue] = useState(PROJECTION_SORT_OPTIONS[0]!.value);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // The club the reader jumped to, kept marked so it is still findable after a re-sort.
  const [jumpedTo, setJumpedTo] = useState<number | null>(null);

  const controlsRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<number, HTMLLIElement>());

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

  // Alphabetical regardless of how the list is sorted: this is a lookup, not a ranking.
  const jumpOptions = useMemo(
    () => [...projections].sort((a, b) => a.teamName.localeCompare(b.teamName)),
    [projections],
  );

  const toggle = (teamId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  // Twenty cards is six phone screens of scrolling with no way to reach your own club.
  const jumpTo = (teamId: number) => {
    setJumpedTo(teamId);
    const card = cardRefs.current.get(teamId);
    const scroller = card && scrollParent(card);
    if (!card || !scroller) return;
    // The controls stay put above the list, so land the card below them rather than under them.
    // They stick to the scrollport's content edge, so their height alone is not the offset —
    // the panel's own top padding sits above them, and the card has to clear both.
    const padding = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    const offset = padding + (controlsRef.current?.offsetHeight ?? 0);
    const top =
      scroller.scrollTop +
      card.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      offset;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  return (
    <div className="projection-cards-wrap">
      {/* Sort, jump and the shared axis travel together: a jump control that scrolls out of
          reach is no use precisely when the list is long enough to need one. */}
      <div className="projection-cards-controls" ref={controlsRef}>
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

          {/* Resets to the placeholder after each jump, so the same club can be jumped to twice. */}
          <select
            className="projection-cards-jump"
            aria-label="Jump to team"
            value=""
            onChange={(e) => {
              if (e.target.value) jumpTo(Number(e.target.value));
            }}
          >
            <option value="">Jump to…</option>
            {jumpOptions.map((row) => (
              <option key={row.teamId} value={row.teamId}>
                {row.teamName}
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
      </div>

      <ol className="projection-cards">
        {rows.map((row, index) => {
          const open = expanded.has(row.teamId);
          return (
            <li
              key={row.teamId}
              className={`projection-card${row.teamId === jumpedTo ? ' projection-card-jumped' : ''}`}
              ref={(el) => {
                if (el) cardRefs.current.set(row.teamId, el);
                else cardRefs.current.delete(row.teamId);
              }}
            >
              {/* The whole head is the toggle. A separate "Show detail" button cost a row of its
                  own on every card — a third of the card's height — to say what a chevron says. */}
              <button
                type="button"
                className="projection-card-head"
                aria-expanded={open}
                onClick={() => toggle(row.teamId)}
              >
                <span className="projection-card-rank">{index + 1}</span>
                <span className="projection-card-team">
                  <TeamBadge
                    team={byId.get(row.teamId)}
                    teamName={row.teamName}
                    codeClassName="league-table-short"
                  />
                  {row.teamName}
                </span>
                <span className="projection-card-chevron" aria-hidden="true">
                  {open ? '▾' : '▸'}
                </span>
              </button>

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
