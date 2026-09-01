import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { computeLeagueStandings, type PlayedMatch } from '@shared/engine/standings.js';
import type { ActualMatchResult, Fixture, Team } from '@shared/engine/types.js';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import { matchweekMovement, matchweekProjections } from '../lib/matchweekSeries.js';
import { useElementSize } from '../lib/useElementSize.js';
import { PROJECTIONS_CARDS_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import type { MatchdayProjection, SeasonProjection } from '../types.js';
import { EloTrendChart } from './EloTrendChart.js';
import { MatchweekProjectionControl } from './MatchweekProjectionControl.js';
import { OverPerformanceChart } from './OverPerformanceChart.js';
import { ProjectionCardList } from './ProjectionCardList.js';
import { ProjectionHeadline } from './ProjectionHeadline.js';
import { ProjectionMovers } from './ProjectionMovers.js';
import { ProjectionsTable } from './ProjectionsTable.js';
import { ProjectionTrendChart } from './ProjectionTrendChart.js';
import { ZoneLegend } from './ZoneLegend.js';

interface Props {
  /** The active batch's projection — the fallback when no matchweek carries one of its own. */
  projections: TeamSeasonProjection[];
  runs: number;
  teams: Team[];
  fixtures: Fixture[];
  actualResults: ActualMatchResult[];
  /** Which simulation each matchday is read through. */
  matchdayProjections: MatchdayProjection[];
  /** Those simulations' finishing odds, one entry per distinct batch. */
  seasonProjections: SeasonProjection[];
  /** Lowest matchday still unplayed, or null once the season is complete. */
  nextMatchday: number | null;
  loading?: boolean;
}

/** Last day of football inside `matchday`, which is where a dated series has to be cut. */
function lastKickoffThrough(fixtures: Fixture[], matchday: number): string | null {
  let latest: string | null = null;
  for (const fixture of fixtures) {
    if (fixture.matchday > matchday) continue;
    if (latest == null || fixture.date > latest) latest = fixture.date;
  }
  return latest;
}

/** The real table as it stood after `matchday`, which is what a projection is measured against. */
function playedThrough(
  fixtures: Fixture[],
  actualResults: ActualMatchResult[],
  matchday: number,
): PlayedMatch[] {
  const byMatchNumber = new Map(fixtures.map((fixture) => [fixture.matchNumber, fixture]));
  const played: PlayedMatch[] = [];
  for (const result of actualResults) {
    const fixture = byMatchNumber.get(result.matchNumber);
    if (!fixture || fixture.matchday > matchday) continue;
    played.push({
      homeTeamId: fixture.teamHomeId,
      awayTeamId: fixture.teamAwayId,
      goalsHome: result.goalsHome,
      goalsAway: result.goalsAway,
    });
  }
  return played;
}

export function ProjectionsView({
  projections,
  runs,
  teams,
  fixtures,
  actualResults,
  matchdayProjections,
  seasonProjections,
  nextMatchday,
  loading = false,
}: Props) {
  // Branches here rather than inside ProjectionsTable, which MonteCarloModal also renders with
  // showDistribution={false} — cards built around the distribution bar make no sense there.
  // Switch at 900px, where the table drops its distribution column, so the cards (which keep
  // the distribution) take over exactly there rather than leaving a gap down to 640px.
  const narrow = useMediaQuery(PROJECTIONS_CARDS_QUERY);

  // The picker pins to the top of the scrolling panel, and its height is published to the panel
  // so the card list's own sticky toolbar can sit below it rather than under it. Measured rather
  // than assumed: it wraps to two or three rows on a narrow screen.
  const controlRef = useRef<HTMLDivElement>(null);
  const controlSize = useElementSize(controlRef);

  // Null until the reader moves it, so the view opens on the current week rather than on a
  // number captured before the matchday attachments arrived.
  const [matchweekChoice, setMatchweekChoice] = useState<number | null>(null);

  const series = useMemo(
    () => matchweekProjections(matchdayProjections, seasonProjections, nextMatchday),
    [matchdayProjections, seasonProjections, nextMatchday],
  );

  const latest = series.at(-1)?.matchday ?? null;
  const earliest = series[0]?.matchday ?? null;
  const matchweek =
    latest == null
      ? null
      : Math.min(latest, Math.max(earliest ?? 1, matchweekChoice ?? latest));

  const index = matchweek == null ? -1 : series.findIndex((week) => week.matchday === matchweek);
  const current = index >= 0 ? series[index]! : null;
  const previousMatchweek = index > 0 ? series[index - 1]!.matchday : null;

  // A snapshot published before matchweeks were browsable carries the active batch and nothing
  // else, so the view falls back to it rather than emptying out.
  const shownProjections = current?.teams ?? projections;
  const shownRuns = current?.runs ?? runs;

  const movement = useMemo(
    () => (matchweek == null || previousMatchweek == null ? undefined : matchweekMovement(series, matchweek)),
    [series, matchweek, previousMatchweek],
  );
  const movementSince = previousMatchweek == null ? '' : `since MW${previousMatchweek}`;

  const playedMatches = useMemo(
    () => (matchweek == null ? [] : playedThrough(fixtures, actualResults, matchweek)),
    [fixtures, actualResults, matchweek],
  );
  const standings = useMemo(
    () => computeLeagueStandings(teams, playedMatches),
    [teams, playedMatches],
  );

  const eloThroughDate = useMemo(
    () => (matchweek == null ? null : lastKickoffThrough(fixtures, matchweek)),
    [fixtures, matchweek],
  );

  return (
    <div className="projections-view">
      <div
        className="projections-panel"
        style={
          { '--matchweek-control-height': `${controlSize?.height ?? 0}px` } as CSSProperties
        }
      >
        {loading ? (
          <p className="muted">Loading projections…</p>
        ) : shownProjections.length === 0 ? (
          <p className="muted">No projection data available.</p>
        ) : (
          <>
            {matchweek != null && current && (
              <MatchweekProjectionControl
                elementRef={controlRef}
                value={matchweek}
                min={earliest ?? 1}
                max={latest ?? matchweek}
                name={current.name}
                runs={current.runs}
                forecast={current.forecast}
                now={nextMatchday}
                onChange={setMatchweekChoice}
              />
            )}

            <ProjectionHeadline
              projections={shownProjections}
              runs={shownRuns}
              nextMatchday={nextMatchday}
              teams={teams}
            />

            {movement && (
              <ProjectionMovers
                projections={shownProjections}
                movement={movement}
                teams={teams}
                previousMatchweek={previousMatchweek}
              />
            )}

            {/* The distribution bars are entirely colour-encoded, so this view needs the
                key at least as much as the tables do. */}
            <ZoneLegend />
            {narrow ? (
              <ProjectionCardList
                projections={shownProjections}
                runs={shownRuns}
                teams={teams}
                movement={movement}
                movementSince={movementSince}
              />
            ) : (
              <ProjectionsTable
                projections={shownProjections}
                runs={shownRuns}
                teams={teams}
                movement={movement}
                movementSince={movementSince}
              />
            )}

            {matchweek != null && (
              <ProjectionTrendChart series={series} teams={teams} matchday={matchweek} />
            )}

            {matchweek != null && (
              <OverPerformanceChart
                standings={standings}
                projections={shownProjections}
                matchweek={matchweek}
                playedMatches={playedMatches.length}
              />
            )}

            <EloTrendChart teams={teams} throughDate={eloThroughDate} matchweek={matchweek} />
          </>
        )}
      </div>
    </div>
  );
}
