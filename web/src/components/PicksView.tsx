import { useMemo, useState } from 'react';
import type { SeasonState, Team } from '@shared/engine/types.js';
import { PICK_STRATEGY_DESCRIPTIONS, PICK_STRATEGY_HINT, PICK_STRATEGY_OPTIONS } from '../lib/pickStrategy.js';
import type { PickStrategy } from '../lib/pickStrategy.js';
import { filterMatchesByTeam } from '../lib/matchFilters.js';
import { FixtureList } from './FixtureList.js';
import { LeagueTable } from './LeagueTable.js';
import { ScoringRulesControl } from './ScoringRulesControl.js';
import { SeasonLayout } from './SeasonLayout.js';

interface Props {
  teams: Team[];
  picksState: SeasonState | null;
  picksError: string | null;
  loading?: boolean;
  runs: number;
  /** Lowest matchday still unplayed, used to anchor the fixture list. */
  nextMatchday: number | null;
  pickStrategy: PickStrategy;
  savingPickStrategy?: boolean;
  /** Absent in public mode, where the mode is fixed by the published snapshot. */
  onPickStrategyChange?: (strategy: PickStrategy) => void;
  scoringRules: { exactScore: number; correctResult: number };
  /** Absent in public mode, alongside `onPickStrategyChange`. */
  onScoringRulesChange?: (points: { exactScore: number; correctResult: number }) => void;
  selectedMatchNumber: number | null;
  onSelectMatch: (matchNumber: number | null) => void;
  onOpenMatch: (matchNumber: number) => void;
}

export function PicksView({
  teams,
  picksState,
  picksError,
  loading = false,
  runs,
  nextMatchday,
  pickStrategy,
  savingPickStrategy = false,
  onPickStrategyChange,
  scoringRules,
  onScoringRulesChange,
  selectedMatchNumber,
  onSelectMatch,
  onOpenMatch,
}: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const pickedMatches = useMemo(
    () => filterMatchesByTeam(picksState?.matches ?? [], selectedTeamId),
    [picksState, selectedTeamId],
  );

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
    onSelectMatch(null);
  };

  if (picksError) {
    return (
      <div className="projections-panel">
        <p className="modal-warning">{picksError}</p>
      </div>
    );
  }

  if (loading || !picksState) {
    return (
      <div className="projections-panel">
        <p className="muted">Loading the picks season…</p>
      </div>
    );
  }

  // The strategy is a property of this table, so it is set from beside it.
  const strategyControl = onPickStrategyChange && (
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
      <p className="pick-strategy-description muted">
        {PICK_STRATEGY_DESCRIPTIONS[pickStrategy]}
      </p>
      {/* The payoff only means anything to the strategy it drives, so it appears with it. */}
      {pickStrategy === 'maxPoints' && onScoringRulesChange && (
        <ScoringRulesControl
          exactScore={scoringRules.exactScore}
          correctResult={scoringRules.correctResult}
          disabled={savingPickStrategy}
          onChange={onScoringRulesChange}
        />
      )}
    </div>
  );

  return (
    <SeasonLayout
      standings={
        <div className="standings-scroll">
          <LeagueTable
            standings={picksState.standings}
            title="Picks table"
            subtitle={`One scoreline per fixture across ${runs.toLocaleString()} simulated seasons`}
            tone="projected"
            matchesPlayed={picksState.matchesPlayed}
            matchesTotal={picksState.matchesTotal}
            titleActions={strategyControl}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
        </div>
      }
      fixtures={
        <FixtureList
          matches={pickedMatches}
          selectedMatchNumber={selectedMatchNumber}
          initialMatchday={nextMatchday}
          filterTeamLabel={selectedTeam?.shortName ?? null}
          emptyMessage="No fixtures available."
          onSelect={onSelectMatch}
          onOpenMatch={onOpenMatch}
          onClearFilter={() => setSelectedTeamId(null)}
        />
      }
    />
  );
}
