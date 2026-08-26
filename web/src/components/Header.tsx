import type { AppView } from '../lib/appView.js';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { THEME_OPTIONS, useTheme } from '../lib/useTheme.js';
import { HeaderDropdownMenu } from './HeaderDropdownMenu.js';
import { ViewHelpButton } from './ViewHelpButton.js';
import { ViewSwitcher } from './ViewSwitcher.js';

interface Props {
  appView: AppView;
  publicMode?: boolean;
  activePredictionLabel: string | null;
  recordedResultCount: number;
  /** Lowest matchday still unplayed, or null once the season is complete. */
  nextMatchday: number | null;
  monteCarloRunning?: boolean;
  weekRunning?: boolean;
  onAppViewChange: (view: AppView) => void;
  onOpenMonteCarlo: () => void;
  onOpenWeekRun: () => void;
  onOpenPredictions: () => void;
  onOpenRatings: () => void;
  onSyncFixtures: () => void;
  fixturesSyncing?: boolean;
}

export function Header({
  appView,
  publicMode = false,
  activePredictionLabel,
  recordedResultCount,
  nextMatchday,
  monteCarloRunning = false,
  weekRunning = false,
  onAppViewChange,
  onOpenMonteCarlo,
  onOpenWeekRun,
  onOpenPredictions,
  onOpenRatings,
  onSyncFixtures,
  fixturesSyncing = false,
}: Props) {
  const narrow = useMediaQuery(MOBILE_QUERY);
  const { preference, setPreference } = useTheme();
  const isProjectionFamily = appView === 'picks' || appView === 'projections';
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

  // The menu holds navigation only, and holds the same entries everywhere: contents that change
  // per view break muscle memory. Unavailable entries are disabled with a reason, not hidden.
  const projectionsUnavailable = publicMode
    ? 'Projections are fixed in the published snapshot'
    : isResultsView
      ? 'Switch to Picks or Projections to manage batches'
      : null;

  const optionsMenu = (
    <HeaderDropdownMenu
      buttonLabel={
        <>
          More <span aria-hidden="true">▾</span>
        </>
      }
      buttonClassName="btn btn-ghost header-options-btn"
      menuClassName="header-options-panel"
      ariaLabel="Options"
    >
      <button type="button" className="btn btn-ghost" onClick={onOpenRatings}>
        Team Ratings
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={projectionsUnavailable != null}
        title={projectionsUnavailable ?? undefined}
        onClick={onOpenPredictions}
      >
        Manage Projections
      </button>
      {/* Occasional rather than weekly: the calendar only moves when a match is rearranged, so
          it sits in the menu rather than costing a header slot. */}
      {!publicMode && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={fixturesSyncing}
          title="Check fixturedownload for rearranged kickoffs and apply them"
          onClick={onSyncFixtures}
        >
          {fixturesSyncing ? 'Checking…' : 'Update Fixtures'}
        </button>
      )}
      {/* Switching theme should not dismiss the menu — stop the panel's close-on-click here so
          the reader can compare System / Light / Dark without reopening. */}
      <div
        className="header-menu-theme"
        role="group"
        aria-label="Theme"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="header-menu-theme-label">Theme</span>
        <div className="header-menu-theme-options">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`btn btn-ghost btn-small ${preference === option.value ? 'active' : ''}`}
              aria-pressed={preference === option.value}
              onClick={() => setPreference(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
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
      {/* The week loop starts from the weekend's results, so it is offered in every view —
          unlike Monte Carlo, which only makes sense where a projection is on screen. It shrinks
          to an icon on narrow screens, where a second worded button costs the app title. */}
      {!publicMode && (
        <button
          type="button"
          className={`btn ${narrow ? 'header-icon-btn header-week-btn' : ''}`}
          disabled={weekRunning}
          aria-label={narrow ? 'Run Week' : undefined}
          title="Sync results, refresh Elo, grade, re-project and export"
          onClick={onOpenWeekRun}
        >
          {narrow ? <span aria-hidden="true">⟳</span> : weekRunning ? 'Running…' : 'Run Week'}
        </button>
      )}
      {optionsMenu}
      <ViewHelpButton appView={appView} publicMode={publicMode} />
    </>
  );

  if (narrow) {
    return (
      <header className="header header-mobile">
        {/* The tab bar takes its own row: three tabs plus the title and two icon buttons do not
            fit on one line at 375px. */}
        <ViewSwitcher appView={appView} short onAppViewChange={onAppViewChange} />
        <div className="header-row">
          <div className="header-left">
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
        <ViewSwitcher appView={appView} onAppViewChange={onAppViewChange} />
        <h1 className="header-title">Premier League Simulator</h1>
        {meta}
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
