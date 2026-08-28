import { useMemo, useState } from 'react';
import { computeLeagueStandings } from '@shared/engine/standings.js';
import type {
  ActualMatchResult,
  Fixture,
  ResolvedMatch,
  SeasonState,
  Team,
} from '@shared/engine/types.js';
import { formatKickoffDate } from '../lib/fixtureLabel.js';
import { filterMatchesByTeam } from '../lib/matchFilters.js';
import {
  applyMatchdayCutoff,
  lastMatchday,
  nowMatchday,
  playedMatchesFor,
  playedThroughMatchday,
} from '../lib/matchdayCutoff.js';
import { projectionsByMatchday } from '../lib/matchdayProjections.js';
import { PICK_STRATEGY_HINT, PICK_STRATEGY_OPTIONS } from '../lib/pickStrategy.js';
import type { PickStrategy } from '../lib/pickStrategy.js';
import type { MatchdayProjection } from '../types.js';
import { FixtureList } from './FixtureList.js';
import { LeagueTable } from './LeagueTable.js';
import { MatchdayCutoffControl } from './MatchdayCutoffControl.js';
import { SeasonLayout } from './SeasonLayout.js';

interface Props {
  teams: Team[];
  fixtures: Fixture[];
  actualResults: ActualMatchResult[];
  /**
   * The representative season: real results, with a picked scoreline for the rest — each round
   * picked by whichever batch {@link matchdayProjections} attaches to it.
   */
  picksState: SeasonState | null;
  /** Which projection each matchday is read through. */
  matchdayProjections: MatchdayProjection[];
  picksError: string | null;
  loading?: boolean;
  runs: number;
  /** Lowest matchday still unplayed, used to anchor the fixture list. */
  nextMatchday: number | null;
  pickStrategy: PickStrategy;
  savingPickStrategy?: boolean;
  /** Absent in public mode, where the strategy is fixed by the published snapshot. */
  onPickStrategyChange?: (strategy: PickStrategy) => void;
  selectedMatchNumber: number | null;
  /**
   * Matchday the season is read through, or null to follow the calendar's last round. Held by
   * the app so a trip to Projections and back does not throw the reader's place away.
   */
  cutoffChoice: number | null;
  onCutoffChange: (matchday: number) => void;
  onSelectMatch: (matchNumber: number | null) => void;
  /** Absent until a projection exists, since there is no distribution to open without one. */
  onOpenMatch?: (matchNumber: number) => void;
  /** Absent in public mode, where the snapshot fixes what each matchday was published with. */
  onOpenMatchdayProjection?: (matchday: number) => void;
}

/**
 * The season in one view: what has been played, what the batch picks for the rest, and the
 * table both produce — read as of whichever matchday the cutoff is set to.
 *
 * A projection supplies the picked scorelines. Without one this degrades to the record of
 * real results, derived here from the same engine code the simulator uses because there is no
 * server-side state endpoint for them.
 */
export function SeasonView({
  teams,
  fixtures,
  actualResults,
  picksState,
  matchdayProjections,
  picksError,
  loading = false,
  runs,
  nextMatchday,
  pickStrategy,
  savingPickStrategy = false,
  onPickStrategyChange,
  selectedMatchNumber,
  cutoffChoice,
  onCutoffChange,
  onSelectMatch,
  onOpenMatch,
  onOpenMatchdayProjection,
}: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const projectionByMatchday = useMemo(
    () => projectionsByMatchday(matchdayProjections),
    [matchdayProjections],
  );

  const resultsByMatch = useMemo(
    () => new Map(actualResults.map((result) => [result.matchNumber, result])),
    [actualResults],
  );

  const recordedOnlyMatches = useMemo<ResolvedMatch[]>(() => {
    const resolved: ResolvedMatch[] = [];
    for (const fixture of fixtures) {
      const teamHome = teamsById.get(fixture.teamHomeId);
      const teamAway = teamsById.get(fixture.teamAwayId);
      if (!teamHome || !teamAway) continue;
      const result = resultsByMatch.get(fixture.matchNumber);
      resolved.push({
        fixture,
        teamHome,
        teamAway,
        result: {
          goalsHome: result?.goalsHome ?? null,
          goalsAway: result?.goalsAway ?? null,
          status: result ? 'played' : 'scheduled',
        },
        locked: result != null,
      });
    }
    return resolved;
  }, [fixtures, teamsById, resultsByMatch]);

  const seasonMatches = picksState?.matches ?? recordedOnlyMatches;

  const maxMatchday = useMemo(() => lastMatchday(seasonMatches), [seasonMatches]);
  const playedThrough = useMemo(() => playedThroughMatchday(seasonMatches), [seasonMatches]);
  // "Now" reaches a round past the results: through the round being played next, whose fixtures
  // the cut fills in with their picks.
  const now = useMemo(() => nowMatchday(seasonMatches), [seasonMatches]);
  // Open on where the season actually is. Pre-season there is no such round, so the projected
  // finish leads instead — a table of one picked round is not an opening view.
  const defaultCutoff = playedThrough > 0 ? now : maxMatchday;
  const cutoff = Math.min(cutoffChoice ?? defaultCutoff, maxMatchday);

  const cutMatches = useMemo(
    () => applyMatchdayCutoff(seasonMatches, cutoff),
    [seasonMatches, cutoff],
  );

  const standings = useMemo(
    () => computeLeagueStandings(teams, playedMatchesFor(cutMatches)),
    [teams, cutMatches],
  );

  const { actualCount, predictedCount } = useMemo(() => {
    let actual = 0;
    let predicted = 0;
    for (const match of cutMatches) {
      if (match.result.status !== 'played') continue;
      if (match.locked) actual += 1;
      else predicted += 1;
    }
    return { actualCount: actual, predictedCount: predicted };
  }, [cutMatches]);

  const visibleMatches = useMemo(
    () => filterMatchesByTeam(cutMatches, selectedTeamId),
    [cutMatches, selectedTeamId],
  );

  const selectedTeam = selectedTeamId != null ? (teamsById.get(selectedTeamId) ?? null) : null;

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
    onSelectMatch(null);
  };

  const handleCutoffChange = (matchday: number) => {
    onCutoffChange(matchday);
    onSelectMatch(null);
  };

  // The strategy is a property of the picked scorelines, so it is set from beside them.
  const strategyControl = onPickStrategyChange && picksState && (
    <div
      className="pick-strategy-control"
      role="group"
      aria-label="Picked scorelines"
      title={PICK_STRATEGY_HINT}
    >
      <span className="pick-strategy-label">Scorelines</span>
      <div className="pick-strategy-buttons">
        {PICK_STRATEGY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`btn btn-ghost btn-small ${pickStrategy === option.value ? 'active' : ''}`}
            aria-pressed={pickStrategy === option.value}
            disabled={savingPickStrategy || pickStrategy === option.value}
            onClick={() => onPickStrategyChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  // Projected and actual must not be confusable, so the subtitle names whichever the cut holds.
  const subtitle =
    predictedCount === 0
      ? 'Recorded scores only, synced from fixturedownload'
      : actualCount === 0
        ? `Picked scorelines from ${runs.toLocaleString()} simulated seasons`
        : `Recorded scores where they exist, picked scorelines from ${runs.toLocaleString()} simulated seasons after`;

  // Before a ball is kicked the table is twenty rows of zeros, which says less than one line does.
  const firstKickoff = useMemo(() => {
    const dates = fixtures.map((fixture) => fixture.date).sort();
    return dates[0] ?? null;
  }, [fixtures]);

  const emptyState =
    actualCount + predictedCount === 0 ? (
      // The header already says no matches have been played; this says when they will be.
      <p className="panel-empty">
        {loading
          ? 'Loading the picked season…'
          : firstKickoff
            ? `The season starts ${formatKickoffDate(firstKickoff)}.`
            : 'No fixtures scheduled.'}
      </p>
    ) : undefined;

  return (
    <SeasonLayout
      toolbar={
        <>
          {picksError && <p className="modal-warning">{picksError}</p>}
          <MatchdayCutoffControl
            value={cutoff}
            max={Math.max(1, maxMatchday)}
            playedThrough={playedThrough}
            now={now}
            actualCount={actualCount}
            predictedCount={predictedCount}
            onChange={handleCutoffChange}
          />
        </>
      }
      standings={
        <div className="standings-scroll">
          <LeagueTable
            standings={standings}
            title="League table"
            subtitle={subtitle}
            tone={predictedCount === 0 ? 'actual' : 'projected'}
            matchesPlayed={actualCount + predictedCount}
            matchesTotal={cutMatches.length}
            titleActions={strategyControl}
            emptyState={emptyState}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
        </div>
      }
      fixtures={
        <FixtureList
          matches={visibleMatches}
          selectedMatchNumber={selectedMatchNumber}
          initialMatchday={nextMatchday}
          filterTeamLabel={selectedTeam?.shortName ?? null}
          emptyMessage="No fixtures available."
          onSelect={onSelectMatch}
          onOpenMatch={picksState ? onOpenMatch : undefined}
          projectionByMatchday={projectionByMatchday}
          onOpenMatchdayProjection={onOpenMatchdayProjection}
          onClearFilter={() => setSelectedTeamId(null)}
        />
      }
    />
  );
}
