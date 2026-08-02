import { useMemo, useState } from 'react';
import type { SeasonState, Team } from '@shared/engine/types.js';
import { filterMatchesByTeam } from '../lib/matchFilters.js';
import { FixtureList } from './FixtureList.js';
import { LeagueTable } from './LeagueTable.js';
import { SeasonLayout } from './SeasonLayout.js';

interface Props {
  teams: Team[];
  consensusState: SeasonState | null;
  consensusError: string | null;
  loading?: boolean;
  selectedMatchNumber: number | null;
  onSelectMatch: (matchNumber: number | null) => void;
  onOpenMatch: (matchNumber: number) => void;
}

export function ConsensusView({
  teams,
  consensusState,
  consensusError,
  loading = false,
  selectedMatchNumber,
  onSelectMatch,
  onOpenMatch,
}: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const consensusMatches = useMemo(
    () => filterMatchesByTeam(consensusState?.matches ?? [], selectedTeamId),
    [consensusState, selectedTeamId],
  );

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
    onSelectMatch(null);
  };

  if (consensusError) {
    return (
      <div className="projections-panel">
        <p className="modal-warning">{consensusError}</p>
      </div>
    );
  }

  if (loading || !consensusState) {
    return (
      <div className="projections-panel">
        <p className="muted">Loading predictions…</p>
      </div>
    );
  }

  return (
    <SeasonLayout
      standings={
        <div className="standings-scroll">
          <LeagueTable
            standings={consensusState.standings}
            title="Consensus table"
            matchesPlayed={consensusState.matchesPlayed}
            matchesTotal={consensusState.matchesTotal}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
        </div>
      }
      fixtures={
        <FixtureList
          matches={consensusMatches}
          selectedMatchNumber={selectedMatchNumber}
          filterTeamLabel={selectedTeam?.shortName ?? null}
          allowEdit={false}
          emptyMessage="No consensus fixtures available."
          onSelect={onSelectMatch}
          onOpenMatch={onOpenMatch}
          onClearFilter={() => setSelectedTeamId(null)}
        />
      }
    />
  );
}
