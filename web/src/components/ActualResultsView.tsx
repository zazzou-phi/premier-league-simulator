import { useMemo, useState } from 'react';
import { computeLeagueStandings, type PlayedMatch } from '@shared/engine/standings.js';
import type {
  ActualMatchResult,
  Fixture,
  ResolvedMatch,
  Team,
} from '@shared/engine/types.js';
import { formatKickoffDate } from '../lib/fixtureLabel.js';
import { filterMatchesByTeam } from '../lib/matchFilters.js';
import { FixtureList } from './FixtureList.js';
import { LeagueTable } from './LeagueTable.js';
import { SeasonLayout } from './SeasonLayout.js';

interface Props {
  teams: Team[];
  fixtures: Fixture[];
  actualResults: ActualMatchResult[];
  selectedMatchNumber: number | null;
  /** Lowest matchday still unplayed, used to anchor the fixture list. */
  nextMatchday: number | null;
  onSelectMatch: (matchNumber: number | null) => void;
}

/**
 * The record of what actually happened. Results are synced from fixturedownload and are not
 * editable here — the sync is authoritative and overwrites any local divergence.
 *
 * There is no server-side state endpoint for recorded results, so the real-world table is
 * derived here from the same engine code the simulator uses.
 */
export function ActualResultsView({
  teams,
  fixtures,
  actualResults,
  selectedMatchNumber,
  nextMatchday,
  onSelectMatch,
}: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const resultsByMatch = useMemo(
    () => new Map(actualResults.map((result) => [result.matchNumber, result])),
    [actualResults],
  );

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const resolvedMatches = useMemo<ResolvedMatch[]>(() => {
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

  const standings = useMemo(() => {
    const played: PlayedMatch[] = [];
    for (const fixture of fixtures) {
      const result = resultsByMatch.get(fixture.matchNumber);
      if (!result) continue;
      played.push({
        homeTeamId: fixture.teamHomeId,
        awayTeamId: fixture.teamAwayId,
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
      });
    }
    return computeLeagueStandings(teams, played);
  }, [teams, fixtures, resultsByMatch]);

  const matches = useMemo(
    () => filterMatchesByTeam(resolvedMatches, selectedTeamId),
    [resolvedMatches, selectedTeamId],
  );

  const selectedTeam = selectedTeamId != null ? (teamsById.get(selectedTeamId) ?? null) : null;

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
    onSelectMatch(null);
  };

  // Before a ball is kicked the table is twenty rows of zeros, which says less than one line does.
  const preSeason = actualResults.length === 0;
  const firstKickoff = useMemo(() => {
    const dates = fixtures.map((fixture) => fixture.date).sort();
    return dates[0] ?? null;
  }, [fixtures]);

  return (
    <SeasonLayout
      standings={
        <div className="standings-scroll">
          <LeagueTable
            standings={standings}
            title="Actual table"
            subtitle="Recorded scores only, synced from fixturedownload"
            tone="actual"
            matchesPlayed={actualResults.length}
            matchesTotal={fixtures.length}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
            emptyState={
              preSeason ? (
                // The header already says no matches have been played; this says when they will be.
                <p className="panel-empty">
                  {firstKickoff
                    ? `The season starts ${formatKickoffDate(firstKickoff)}.`
                    : 'No fixtures scheduled.'}
                </p>
              ) : undefined
            }
          />
        </div>
      }
      fixtures={
        <FixtureList
          matches={matches}
          selectedMatchNumber={selectedMatchNumber}
          initialMatchday={nextMatchday}
          filterTeamLabel={selectedTeam?.shortName ?? null}
          emptyMessage="No fixtures available."
          onSelect={onSelectMatch}
          onClearFilter={() => setSelectedTeamId(null)}
        />
      }
    />
  );
}
