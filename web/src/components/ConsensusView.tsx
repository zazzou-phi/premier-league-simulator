import { useMemo, useState } from 'react';
import type { SeasonState, Team } from '@shared/engine/types.js';
import { CONSENSUS_MODE_HINT, CONSENSUS_MODE_OPTIONS } from '../lib/consensusMode.js';
import type { ConsensusMode } from '../lib/consensusMode.js';
import { filterMatchesByTeam } from '../lib/matchFilters.js';
import { FixtureList } from './FixtureList.js';
import { LeagueTable } from './LeagueTable.js';
import { SeasonLayout } from './SeasonLayout.js';

interface Props {
  teams: Team[];
  consensusState: SeasonState | null;
  consensusError: string | null;
  loading?: boolean;
  runs: number;
  /** Lowest matchday still unplayed, used to anchor the fixture list. */
  nextMatchday: number | null;
  consensusMode: ConsensusMode;
  savingConsensusMode?: boolean;
  /** Absent in public mode, where the mode is fixed by the published snapshot. */
  onConsensusModeChange?: (mode: ConsensusMode) => void;
  selectedMatchNumber: number | null;
  onSelectMatch: (matchNumber: number | null) => void;
  onOpenMatch: (matchNumber: number) => void;
}

export function ConsensusView({
  teams,
  consensusState,
  consensusError,
  loading = false,
  runs,
  nextMatchday,
  consensusMode,
  savingConsensusMode = false,
  onConsensusModeChange,
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
        <p className="muted">Loading the consensus season…</p>
      </div>
    );
  }

  // The mode is a property of this table, so it is set from beside it.
  const modeControl = onConsensusModeChange && (
    <div
      className="consensus-mode-control"
      role="group"
      aria-label="Consensus scorelines"
      title={CONSENSUS_MODE_HINT}
    >
      <span className="consensus-mode-label">Scorelines</span>
      <div className="consensus-mode-buttons">
        {CONSENSUS_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`btn btn-ghost btn-small ${consensusMode === option.value ? 'active' : ''}`}
            aria-pressed={consensusMode === option.value}
            disabled={savingConsensusMode || consensusMode === option.value}
            onClick={() => onConsensusModeChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <SeasonLayout
      standings={
        <div className="standings-scroll">
          <LeagueTable
            standings={consensusState.standings}
            title="Consensus table"
            subtitle={`Most likely result per fixture across ${runs.toLocaleString()} simulated seasons`}
            tone="projected"
            matchesPlayed={consensusState.matchesPlayed}
            matchesTotal={consensusState.matchesTotal}
            titleActions={modeControl}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
        </div>
      }
      fixtures={
        <FixtureList
          matches={consensusMatches}
          selectedMatchNumber={selectedMatchNumber}
          initialMatchday={nextMatchday}
          filterTeamLabel={selectedTeam?.shortName ?? null}
          emptyMessage="No consensus fixtures available."
          onSelect={onSelectMatch}
          onOpenMatch={onOpenMatch}
          onClearFilter={() => setSelectedTeamId(null)}
        />
      }
    />
  );
}
