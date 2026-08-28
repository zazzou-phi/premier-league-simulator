import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResolvedMatch } from '@shared/engine/types.js';
import { matchWinnerSide } from '../lib/matchFilters.js';
import type { MatchdayProjection } from '../types.js';
import { FixturePrefix } from './FixturePrefix.js';
import { ScoreDisplay } from './ScoreEditor.js';
import { TeamBadge } from './TeamBadge.js';

interface Props {
  matches: ResolvedMatch[];
  selectedMatchNumber: number | null;
  /** Matchday to scroll to on mount. A 380-row list opened at round 1 is unusable in March. */
  initialMatchday?: number | null;
  filterTeamLabel?: string | null;
  emptyMessage?: string;
  onSelect: (matchNumber: number | null) => void;
  /** Opens the Monte Carlo distribution for a fixture. Absent in the actual-results record. */
  onOpenMatch?: (matchNumber: number) => void;
  /** Which projection each matchday is read through, keyed by matchday. */
  projectionByMatchday?: Map<number, MatchdayProjection>;
  /** Opens the projection picker for a matchday. Absent in public mode, which cannot move one. */
  onOpenMatchdayProjection?: (matchday: number) => void;
  onClearFilter?: () => void;
}

interface MatchdayGroup {
  matchday: number;
  matches: ResolvedMatch[];
}

function groupByMatchday(matches: ResolvedMatch[]): MatchdayGroup[] {
  const groups = new Map<number, ResolvedMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.fixture.matchday);
    if (list) list.push(match);
    else groups.set(match.fixture.matchday, [match]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([matchday, list]) => ({
      matchday,
      // A round is played in kickoff order, not fixture-number order, so it reads that way here.
      // Wall-clock strings sort as they are; match number only breaks a simultaneous kickoff.
      matches: list.sort(
        (a, b) =>
          a.fixture.date.localeCompare(b.fixture.date) ||
          a.fixture.time.localeCompare(b.fixture.time) ||
          a.fixture.matchNumber - b.fixture.matchNumber,
      ),
    }));
}

function teamClassName(match: ResolvedMatch, side: 'home' | 'away'): string {
  const winner = matchWinnerSide(match);
  if (winner === side) return 'fixture-team-winner';
  if (winner != null) return 'fixture-team-loser';
  return '';
}

export function FixtureList({
  matches,
  selectedMatchNumber,
  initialMatchday = null,
  filterTeamLabel = null,
  emptyMessage = 'No fixtures to show.',
  onSelect,
  onOpenMatch,
  projectionByMatchday,
  onOpenMatchdayProjection,
  onClearFilter,
}: Props) {
  const groups = useMemo(() => groupByMatchday(matches), [matches]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef(new Map<number, HTMLDivElement>());
  const anchoredTo = useRef<number | null>(null);
  const [currentMatchday, setCurrentMatchday] = useState<number | null>(null);

  const scrollToMatchday = useCallback((matchday: number): boolean => {
    const body = bodyRef.current;
    const header = headerRefs.current.get(matchday);
    // On mobile SeasonLayout hides this panel with CSS rather than unmounting it, so it can
    // measure zero — scrolling then lands at 0 instead of the matchday.
    if (!body || !header || body.clientHeight === 0) return false;
    body.scrollTop += header.getBoundingClientRect().top - body.getBoundingClientRect().top;
    setCurrentMatchday(matchday);
    return true;
  }, []);

  // Open on the round the season is actually on, once — not on every re-render.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || initialMatchday == null || anchoredTo.current === initialMatchday) return;
    const attempt = () => {
      if (anchoredTo.current === initialMatchday) return;
      if (scrollToMatchday(initialMatchday)) anchoredTo.current = initialMatchday;
    };
    attempt();
    // Retry when a hidden panel gains height, which is when the mobile tab switches to it.
    const observer = new ResizeObserver(attempt);
    observer.observe(body);
    return () => observer.disconnect();
  }, [initialMatchday, groups, scrollToMatchday]);

  // Keep the jump control showing whichever matchday is at the top of the scroller.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const top = body.getBoundingClientRect().top;
      let current = groups[0]?.matchday ?? null;
      for (const group of groups) {
        const header = headerRefs.current.get(group.matchday);
        if (!header) continue;
        if (header.getBoundingClientRect().top - top > 1) break;
        current = group.matchday;
      }
      setCurrentMatchday(current);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      body.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [groups]);

  const matchdayIndex = groups.findIndex((group) => group.matchday === currentMatchday);
  const previousMatchday = matchdayIndex > 0 ? groups[matchdayIndex - 1]?.matchday : undefined;
  const nextMatchday =
    matchdayIndex >= 0 ? groups[matchdayIndex + 1]?.matchday : groups[0]?.matchday;

  return (
    <div className="fixture-list">
      <div className="fixture-list-header">
        <span>
          Fixtures ({matches.length})
          {filterTeamLabel ? ` · ${filterTeamLabel}` : ''}
        </span>
        {filterTeamLabel && onClearFilter && (
          <button
            type="button"
            className="btn btn-ghost btn-small fixture-list-clear-filter"
            onClick={onClearFilter}
          >
            Clear filter
          </button>
        )}
      </div>
      {groups.length > 1 && (
        <div className="fixture-list-nav">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={previousMatchday == null}
            aria-label="Previous matchday"
            onClick={() => previousMatchday != null && scrollToMatchday(previousMatchday)}
          >
            ‹ Prev
          </button>
          <label className="fixture-list-nav-jump">
            <span className="visually-hidden">Jump to matchday</span>
            <select
              className="fixture-list-nav-select"
              value={currentMatchday ?? ''}
              onChange={(e) => scrollToMatchday(Number(e.target.value))}
            >
              {groups.map((group) => (
                <option key={group.matchday} value={group.matchday}>
                  Matchday {group.matchday}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={nextMatchday == null}
            aria-label="Next matchday"
            onClick={() => nextMatchday != null && scrollToMatchday(nextMatchday)}
          >
            Next ›
          </button>
        </div>
      )}
      <div className="fixture-list-body" ref={bodyRef}>
        {matches.length === 0 && <p className="fixture-list-empty">{emptyMessage}</p>}
        {groups.map((group) => {
          const playedInGroup = group.matches.filter(
            (match) => match.result.status === 'played',
          ).length;

          const projection = projectionByMatchday?.get(group.matchday) ?? null;
          // The round is the click target for choosing its projection, so the label that says
          // which one it is sits inside the button rather than beside it.
          const label = (
            <>
              <span>Matchday {group.matchday}</span>
              {projection?.name && (
                <span className="matchday-header-projection">
                  {projection.pinned && <span aria-hidden="true">📌 </span>}
                  {projection.name}
                </span>
              )}
            </>
          );
          const projectionTitle = projection?.name
            ? projection.pinned
              ? `Matchday ${group.matchday} is pinned to "${projection.name}"`
              : `Matchday ${group.matchday} is read through "${projection.name}", the last batch that forecast it`
            : `No projection covers matchday ${group.matchday}`;

          return (
            <div key={group.matchday}>
              <div
                className="matchday-header"
                ref={(el) => {
                  if (el) headerRefs.current.set(group.matchday, el);
                  else headerRefs.current.delete(group.matchday);
                }}
              >
                {onOpenMatchdayProjection ? (
                  <button
                    type="button"
                    className="matchday-header-pick"
                    title={`${projectionTitle}. Choose another.`}
                    onClick={() => onOpenMatchdayProjection(group.matchday)}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="matchday-header-pick" title={projectionTitle}>
                    {label}
                  </span>
                )}
                <span className="matchday-header-meta">
                  {playedInGroup}/{group.matches.length}
                </span>
              </div>
              {group.matches.map((match) => {
                const num = match.fixture.matchNumber;
                const selected = num === selectedMatchNumber;
                const played = match.result.status === 'played';
                // A played fixture the batch predicted shows both: the pick either side of the
                // result it was aiming at. Where the batch was handed the result there is no
                // pick, and the row is the result alone.
                const graded =
                  match.locked &&
                  match.pick != null &&
                  match.result.goalsHome != null &&
                  match.result.goalsAway != null
                    ? {
                        pick: match.pick,
                        actual: {
                          goalsHome: match.result.goalsHome,
                          goalsAway: match.result.goalsAway,
                        },
                      }
                    : null;
                // A distribution only exists behind a scoreline the batch actually shows, so a
                // fixture blanked by the matchday cutoff is inert rather than a click that fails.
                const canOpen = onOpenMatch != null && played;

                return (
                  <div
                    key={num}
                    className={`fixture-row ${selected ? 'selected' : ''}`}
                    onClick={() => onSelect(selected ? null : num)}
                  >
                    <FixturePrefix
                      matchday={match.fixture.matchday}
                      date={match.fixture.date}
                      time={match.fixture.time}
                      locked={match.locked}
                    />
                    <span
                      className={`fixture-home ${teamClassName(match, 'home')}`}
                      title={match.teamHome.name}
                    >
                      <TeamBadge
                        team={match.teamHome}
                        teamName={match.teamHome.name}
                        codeClassName="fixture-team-short"
                      />{' '}
                      {match.teamHome.name}
                    </span>
                    <span className="fixture-score">
                      <ScoreDisplay
                        goalsHome={graded ? graded.pick.goalsHome : match.result.goalsHome}
                        goalsAway={graded ? graded.pick.goalsAway : match.result.goalsAway}
                        played={played}
                        locked={match.locked}
                        actual={graded?.actual}
                        actionLabel={
                          canOpen
                            ? `Outcome distribution: ${match.teamHome.name} vs ${match.teamAway.name}`
                            : undefined
                        }
                        onClick={canOpen ? () => onOpenMatch!(num) : undefined}
                      />
                    </span>
                    <span
                      className={`fixture-away ${teamClassName(match, 'away')}`}
                      title={match.teamAway.name}
                    >
                      {match.teamAway.name}{' '}
                      <TeamBadge
                        team={match.teamAway}
                        teamName={match.teamAway.name}
                        codeClassName="fixture-team-short"
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
