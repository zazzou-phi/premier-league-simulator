import type { AppView } from '../lib/appView.js';
import type { ConsensusMode } from '../lib/consensusMode.js';
import { CONSENSUS_MODE_HINT, CONSENSUS_MODE_OPTIONS } from '../lib/consensusMode.js';
import { DEFAULT_UPSET_VARIANCE } from '../lib/upsetVariance.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from '../lib/seasonForm.js';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { HeaderDropdownMenu } from './HeaderDropdownMenu.js';
import { SeasonFormControl } from './SeasonFormControl.js';
import { UpsetFactorControl } from './UpsetFactorControl.js';
import { ViewHelpButton } from './ViewHelpButton.js';
import { ViewSwitcher } from './ViewSwitcher.js';

interface Props {
  appView: AppView;
  publicMode?: boolean;
  activePredictionLabel: string | null;
  recordedResultCount: number;
  /** Lowest matchday still unplayed, or null once the season is complete. */
  nextMatchday: number | null;
  consensusMode: ConsensusMode;
  savingConsensusMode?: boolean;
  monteCarloRunning?: boolean;
  upsetVariance: number;
  seasonEloDeltaWeight: number;
  onAppViewChange: (view: AppView) => void;
  onUpsetVarianceChange: (value: number) => void;
  onSeasonEloDeltaWeightChange: (value: number) => void;
  onConsensusModeChange: (mode: ConsensusMode) => void;
  onOpenMonteCarlo: () => void;
  onOpenPredictions: () => void;
  onOpenRatings: () => void;
}

export function Header({
  appView,
  publicMode = false,
  activePredictionLabel,
  recordedResultCount,
  nextMatchday,
  consensusMode,
  savingConsensusMode = false,
  monteCarloRunning = false,
  upsetVariance,
  seasonEloDeltaWeight,
  onAppViewChange,
  onUpsetVarianceChange,
  onSeasonEloDeltaWeightChange,
  onConsensusModeChange,
  onOpenMonteCarlo,
  onOpenPredictions,
  onOpenRatings,
}: Props) {
  const narrow = useMediaQuery(MOBILE_QUERY);
  const isProjectionFamily = appView === 'consensus' || appView === 'projections';
  const isResultsView = appView === 'results';

  // Which round the season is actually on — the anchor for a week-by-week workflow.
  const matchdayBadge =
    nextMatchday == null ? (
      <span className="header-matchday" title="Every fixture has been played">
        season complete
      </span>
    ) : (
      <span className="header-matchday" title={`Matchday ${nextMatchday} is the next round to be played`}>
        MD{nextMatchday} next
      </span>
    );

  const meta = isResultsView ? (
    <>
      <span className="header-meta header-results">
        {recordedResultCount} recorded result{recordedResultCount === 1 ? '' : 's'}
      </span>
      {matchdayBadge}
    </>
  ) : (
    <>
      <span className="header-meta header-projections">
        {activePredictionLabel ?? 'No projection loaded'}
      </span>
      {matchdayBadge}
    </>
  );

  const showProjectionSettings = isProjectionFamily && !publicMode;
  const settingsChanged =
    upsetVariance !== DEFAULT_UPSET_VARIANCE ||
    seasonEloDeltaWeight !== DEFAULT_SEASON_ELO_DELTA_WEIGHT;

  const optionsMenu = (
    <HeaderDropdownMenu
      buttonLabel="⋮"
      buttonClassName="btn btn-ghost header-icon-btn header-options-btn"
      menuClassName="header-options-panel"
      ariaLabel="Options"
      active={showProjectionSettings && settingsChanged}
    >
      {showProjectionSettings && (
        <>
          <UpsetFactorControl
            id="header-upset-factor"
            value={upsetVariance}
            disabled={monteCarloRunning}
            onChange={onUpsetVarianceChange}
          />
          <SeasonFormControl
            id="header-season-form"
            value={seasonEloDeltaWeight}
            disabled={monteCarloRunning}
            onChange={onSeasonEloDeltaWeightChange}
          />
          <div className="header-menu-divider" role="separator" />
          <div className="header-settings-segment consensus-mode-control" title={CONSENSUS_MODE_HINT}>
            <span className="header-settings-segment-label">Consensus scorelines</span>
            <div className="header-settings-segment-buttons">
              {CONSENSUS_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`btn btn-ghost ${consensusMode === option.value ? 'active' : ''}`}
                  disabled={savingConsensusMode || consensusMode === option.value}
                  onClick={() => onConsensusModeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="header-menu-divider" role="separator" />
        </>
      )}
      <button type="button" className="btn btn-ghost" onClick={onOpenRatings}>
        Team Ratings
      </button>
      {!publicMode && isProjectionFamily && (
        <button type="button" className="btn btn-ghost" onClick={onOpenPredictions}>
          Manage Projections
        </button>
      )}
    </HeaderDropdownMenu>
  );

  const actions = (
    <>
      {isProjectionFamily && !publicMode && (
        <button
          type="button"
          className="btn btn-simulate"
          disabled={monteCarloRunning}
          onClick={onOpenMonteCarlo}
        >
          {monteCarloRunning ? 'Simulating…' : 'Monte Carlo'}
        </button>
      )}
      {optionsMenu}
      <ViewHelpButton appView={appView} publicMode={publicMode} />
    </>
  );

  if (narrow) {
    return (
      <header className="header header-mobile">
        <div className="header-row">
          <div className="header-left">
            <ViewSwitcher
              appView={appView}
              publicMode={publicMode}
              onAppViewChange={onAppViewChange}
            />
            <h1 className="header-title">PL Sim</h1>
          </div>
          <div className="header-actions">{actions}</div>
        </div>
        <div className="header-meta-row">{meta}</div>
      </header>
    );
  }

  return (
    <header className="header">
      <div className="header-left">
        <ViewSwitcher
          appView={appView}
          publicMode={publicMode}
          onAppViewChange={onAppViewChange}
        />
        <h1 className="header-title">Premier League Simulator</h1>
        {meta}
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
