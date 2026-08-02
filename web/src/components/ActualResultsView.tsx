import { useMemo, useState } from 'react';
import { computeLeagueStandings, type PlayedMatch } from '@shared/engine/standings.js';
import type {
  ActualMatchResult,
  Fixture,
  ResolvedMatch,
  Team,
} from '@shared/engine/types.js';
import { filterMatchesByTeam } from '../lib/matchFilters.js';
import { FixtureList } from './FixtureList.js';
import { LeagueTable } from './LeagueTable.js';
import { SeasonLayout } from './SeasonLayout.js';

interface Props {
  teams: Team[];
  fixtures: Fixture[];
  actualResults: ActualMatchResult[];
  selectedMatchNumber: number | null;
  editingMatchNumber: number | null;
  readOnly?: boolean;
  onSelectMatch: (matchNumber: number | null) => void;
  onStartEdit: (matchNumber: number) => void;
  onSaveScore: (matchNumber: number, goalsHome: number, goalsAway: number) => void;
  onCancelEdit: () => void;
  onClearScore: (matchNumber: number) => void;
}

/**
 * Recorded results have no server-side state endpoint, so the real-world table is derived
 * here from the same engine code the simulator uses.
 */
export function ActualResultsView({
  teams,
  fixtures,
  actualResults,
  selectedMatchNumber,
  editingMatchNumber,
  readOnly = false,
  onSelectMatch,
  onStartEdit,
  onSaveScore,
  onCancelEdit,
  onClearScore,
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

  return (
    <SeasonLayout
      standings={
        <div className="standings-scroll">
          <LeagueTable
            standings={standings}
            title="Actual table"
            matchesPlayed={actualResults.length}
            matchesTotal={fixtures.length}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
        </div>
      }
      fixtures={
        <FixtureList
          matches={matches}
          selectedMatchNumber={selectedMatchNumber}
          editingMatchNumber={editingMatchNumber}
          filterTeamLabel={selectedTeam?.shortName ?? null}
          allowEdit={!readOnly}
          editRecordedResults
          emptyMessage="No fixtures available."
          onSelect={onSelectMatch}
          onStartEdit={onStartEdit}
          onSave={onSaveScore}
          onCancelEdit={onCancelEdit}
          onClear={onClearScore}
          onClearFilter={() => setSelectedTeamId(null)}
        />
      }
    />
  );
}
