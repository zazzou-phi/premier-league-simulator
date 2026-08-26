import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findNextMatchday } from '@shared/engine/schedule.js';
import type { MatchDistribution, TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type {
  ActualMatchResult,
  Fixture,
  SeasonState,
  Team,
} from '@shared/engine/types.js';
import { api, isPublicMode, type WeekRunOptions } from './api/client.js';
import { loadPublicMeta } from './api/staticClient.js';
import { ActualResultsView } from './components/ActualResultsView.js';
import { PicksView } from './components/PicksView.js';
import { Header } from './components/Header.js';
import { MatchDistributionModal } from './components/MatchDistributionModal.js';
import { MonteCarloModal } from './components/MonteCarloModal.js';
import { WeekRunModal } from './components/WeekRunModal.js';
import { PredictionManagerModal } from './components/PredictionManagerModal.js';
import { ProjectionsView } from './components/ProjectionsView.js';
import { TeamRatingsModal } from './components/TeamRatingsModal.js';
import type { AppView } from './lib/appView.js';
import {
  DEFAULT_PICK_STRATEGY,
  formatPickStrategy,
  type PickStrategy,
} from './lib/pickStrategy.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from './lib/seasonForm.js';
import { DEFAULT_UPSET_VARIANCE } from './lib/upsetVariance.js';
import { applyWeekEvent, IDLE_WEEK_RUN, STARTED_WEEK_RUN, type WeekRunState } from './lib/weekRunLog.js';
import { ApiRequestError, type MonteCarloRunResult, type Prediction, type PublicMeta } from './types.js';

type ModalKind = 'predictions' | 'ratings' | 'monteCarlo' | 'week' | null;

/**
 * The default projection name is `Monte Carlo {runs}`, so appending the run count
 * unconditionally printed it twice — `Monte Carlo 1,000 · 1,000 runs`. Only add the
 * suffix when the name does not already carry the figure.
 */
function predictionLabel(name: string, runs: number): string {
  const formatted = runs.toLocaleString();
  return name.includes(formatted) ? name : `${name} · ${formatted} runs`;
}

interface MonteCarloState {
  running: boolean;
  progress: { completed: number; total: number } | null;
  result: MonteCarloRunResult | null;
  error: string | null;
}

interface DistributionState {
  matchNumber: number;
  data: MatchDistribution | null;
  loading: boolean;
  error: string | null;
}

interface ProjectionState {
  prediction: Prediction | null;
  runs: number;
  teams: TeamSeasonProjection[];
  picks: SeasonState | null;
  error: string | null;
  loading: boolean;
}

const EMPTY_PROJECTIONS: ProjectionState = {
  prediction: null,
  runs: 0,
  teams: [],
  picks: null,
  error: null,
  loading: false,
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function App() {
  const publicMode = isPublicMode();

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fixturesSyncing, setFixturesSyncing] = useState(false);

  // The forecast is the answer the engine exists to compute, so it leads. Bootstrap falls back to
  // the picks season when there is no batch to project from.
  const [appView, setAppView] = useState<AppView>('projections');
  const [teams, setTeams] = useState<Team[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [actualResults, setActualResults] = useState<ActualMatchResult[]>([]);
  const [projections, setProjections] = useState<ProjectionState>(EMPTY_PROJECTIONS);
  const [publicMeta, setPublicMeta] = useState<PublicMeta | null>(null);

  const [selectedMatchNumber, setSelectedMatchNumber] = useState<number | null>(null);

  const [upsetVariance, setUpsetVariance] = useState(DEFAULT_UPSET_VARIANCE);
  const [seasonEloDeltaWeight, setSeasonEloDeltaWeight] = useState(
    DEFAULT_SEASON_ELO_DELTA_WEIGHT,
  );
  // Season form is read server-side from settings at run time, so a run must not start while
  // the write for the value the user just picked is still in flight.
  const pendingSettingsWrite = useRef<Promise<unknown>>(Promise.resolve());

  const [savingPickStrategy, setSavingPickStrategy] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloState>({
    running: false,
    progress: null,
    result: null,
    error: null,
  });
  const [weekRun, setWeekRun] = useState<WeekRunState>(IDLE_WEEK_RUN);
  const [distribution, setDistribution] = useState<DistributionState | null>(null);

  const loadProjection = useCallback(async (prediction: Prediction) => {
    setProjections((prev) => ({ ...prev, prediction, loading: true, error: null }));
    try {
      const [projectionData, picks] = await Promise.all([
        api.getPredictionProjections(prediction.id),
        api.getPredictionState(prediction.id).catch(() => null),
      ]);
      setProjections({
        prediction,
        runs: projectionData.runs,
        teams: projectionData.teams,
        picks,
        error: null,
        loading: false,
      });
    } catch (err) {
      setProjections({
        ...EMPTY_PROJECTIONS,
        prediction,
        error: errorMessage(err, 'Failed to load projections'),
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [teamList, fixtureList] = await Promise.all([api.listTeams(), api.listFixtures()]);
        setTeams(teamList);
        setFixtures(fixtureList);
        setActualResults(await api.listActualResults().catch(() => []));

        if (publicMode) {
          const meta = await loadPublicMeta().catch(() => null);
          setPublicMeta(meta);
          if (meta?.predictionId == null) {
            setAppView('picks');
          } else {
            await loadProjection({
              id: meta.predictionId,
              name: meta.predictionName ?? 'Season',
              runs: meta.runs,
              pickStrategy: DEFAULT_PICK_STRATEGY,
              asOfMatchday: meta.asOfMatchday ?? null,
              lockedCount: 0,
              createdAt: meta.exportedAt,
              updatedAt: meta.exportedAt,
            });
          }
        } else {
          const [upset, seasonForm] = await Promise.all([
            api.getUpsetVariance().catch(() => ({ value: DEFAULT_UPSET_VARIANCE })),
            api
              .getSeasonEloDeltaWeight()
              .catch(() => ({ value: DEFAULT_SEASON_ELO_DELTA_WEIGHT })),
          ]);
          setUpsetVariance(upset.value);
          setSeasonEloDeltaWeight(seasonForm.value);

          const predictionPage = await api.listPredictions(1, 1).catch(() => null);
          const prediction = predictionPage?.items[0] ?? null;
          if (prediction) await loadProjection(prediction);
          else setAppView('picks');
        }
      } catch (err) {
        setFatalError(errorMessage(err, 'Failed to load the simulator'));
      } finally {
        setLoading(false);
      }
    })();
  }, [publicMode, loadProjection]);

  // Success toasts are confirmations, so they time out. Errors persist until dismissed.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const pickStrategy = projections.prediction?.pickStrategy ?? DEFAULT_PICK_STRATEGY;

  // Same rule the engine uses for naming projections, so header and CLI never disagree.
  const nextMatchday = useMemo(
    () => findNextMatchday(fixtures, new Set(actualResults.map((r) => r.matchNumber))),
    [fixtures, actualResults],
  );

  const distributionMatch = useMemo(() => {
    if (!distribution || !projections.picks) return null;
    return (
      projections.picks.matches.find(
        (match) => match.fixture.matchNumber === distribution.matchNumber,
      ) ?? null
    );
  }, [distribution, projections.picks]);

  const switchPrediction = async (id: number) => {
    setError(null);
    setModal(null);
    setSelectedMatchNumber(null);
    try {
      const page = await api.listPredictions(1, 200);
      const prediction = page.items.find((item) => item.id === id);
      if (!prediction) throw new Error(`Projection #${id} not found`);
      await loadProjection(prediction);
    } catch (err) {
      setError(errorMessage(err, 'Failed to open projection'));
    }
  };

  const handleRenamePrediction = async (id: number, name: string) => {
    const updated = await api.renamePrediction(id, name);
    if (projections.prediction?.id === id) {
      setProjections((prev) => ({ ...prev, prediction: updated }));
    }
  };

  const handleDeletePrediction = async (id: number) => {
    await api.deletePrediction(id);
    if (projections.prediction?.id !== id) return;
    const page = await api.listPredictions(1, 1);
    const next = page.items[0];
    if (next) await loadProjection(next);
    else setProjections(EMPTY_PROJECTIONS);
  };

  const handlePickStrategyChange = async (strategy: PickStrategy) => {
    const prediction = projections.prediction;
    if (!prediction) return;
    setError(null);
    setSavingPickStrategy(true);
    try {
      const updated = await api.setPredictionPickStrategy(prediction.id, strategy);
      const picks = await api.getPredictionState(prediction.id).catch(() => null);
      setProjections((prev) => ({ ...prev, prediction: updated, picks }));
      setToast(`Scorelines picked by ${formatPickStrategy(strategy).toLowerCase()}`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to update the pick strategy'));
    } finally {
      setSavingPickStrategy(false);
    }
  };

  const trackSettingsWrite = (write: Promise<unknown>) => {
    pendingSettingsWrite.current = Promise.allSettled([pendingSettingsWrite.current, write]);
  };

  const handleUpsetVarianceChange = (value: number) => {
    setUpsetVariance(value);
    if (publicMode) return;
    trackSettingsWrite(
      api.setUpsetVariance(value).catch((err: unknown) => {
        setError(errorMessage(err, 'Failed to save upset factor'));
      }),
    );
  };

  const handleSeasonEloDeltaWeightChange = (value: number) => {
    setSeasonEloDeltaWeight(value);
    if (publicMode) return;
    trackSettingsWrite(
      api.setSeasonEloDeltaWeight(value).catch((err: unknown) => {
        setError(errorMessage(err, 'Failed to save season form'));
      }),
    );
  };

  const handleResetRunParameters = () => {
    handleUpsetVarianceChange(DEFAULT_UPSET_VARIANCE);
    handleSeasonEloDeltaWeightChange(DEFAULT_SEASON_ELO_DELTA_WEIGHT);
  };

  const handleRunMonteCarlo = async (runs: number, name: string) => {
    setMonteCarlo({ running: true, progress: { completed: 0, total: runs }, result: null, error: null });
    try {
      await pendingSettingsWrite.current;
      const result = await api.runMonteCarlo(runs, {
        upsetVariance,
        name,
        onProgress: (completed, total) => {
          setMonteCarlo((prev) => ({ ...prev, progress: { completed, total } }));
        },
      });
      setMonteCarlo({ running: false, progress: null, result, error: null });

      const page = await api.listPredictions(1, 200).catch(() => null);
      const prediction = page?.items.find((item) => item.id === result.predictionId) ?? null;
      if (prediction) await loadProjection(prediction);
      setToast(`Simulated ${result.runs.toLocaleString()} seasons`);
    } catch (err) {
      setMonteCarlo({
        running: false,
        progress: null,
        result: null,
        error: errorMessage(err, 'Failed to run Monte Carlo simulation'),
      });
    }
  };

  const handleRunWeek = async (options: WeekRunOptions) => {
    setWeekRun(STARTED_WEEK_RUN);
    try {
      const result = await api.runWeek({
        ...options,
        onEvent: (event) => setWeekRun((prev) => applyWeekEvent(prev, event)),
      });
      setWeekRun((prev) => ({ ...prev, running: false, progress: null, result }));
      if (result.dryRun) return;

      // The run just moved everything the shell is showing: results, ratings and the batch.
      const [teamList, results] = await Promise.all([
        api.listTeams(),
        api.listActualResults().catch(() => actualResults),
      ]);
      setTeams(teamList);
      setActualResults(results);

      const predictionId = result.projection.predictionId;
      if (predictionId != null) {
        const page = await api.listPredictions(1, 200).catch(() => null);
        const prediction = page?.items.find((item) => item.id === predictionId) ?? null;
        if (prediction) await loadProjection(prediction);
      }
      setToast(
        `Week advanced — ${result.results.applied} result${result.results.applied === 1 ? '' : 's'} locked`,
      );
    } catch (err) {
      setWeekRun((prev) => ({
        ...prev,
        running: false,
        progress: null,
        error: errorMessage(err, 'Failed to advance the week'),
        errorCode: err instanceof ApiRequestError ? (err.code ?? null) : null,
      }));
    }
  };

  /**
   * Pull the remote calendar and apply any rearranged kickoffs.
   *
   * Ratings need no separate step: they are recomputed from the anchor plus the results, so
   * moving a fixture re-dates that round's history point on its own — the server rebuilds and
   * prunes whatever the move invalidated.
   */
  const handleSyncFixtures = async () => {
    setFixturesSyncing(true);
    try {
      const { fixtures: sync, history } = await api.syncFixtures();

      if (sync.mismatched.length > 0) {
        setToast(
          `${sync.mismatched.length} fixture(s) name different teams remotely — not applied, the list may have been renumbered`,
        );
      } else if (sync.moved.length === 0) {
        setToast('Fixtures are already up to date');
      } else {
        const [fixtureList, teamList] = await Promise.all([
          api.listFixtures(),
          api.listTeams().catch(() => teams),
        ]);
        setFixtures(fixtureList);
        setTeams(teamList);
        const rebuilt = history
          ? ` — Elo history rebuilt over ${history.points.length} day(s)`
          : '';
        setToast(`${sync.moved.length} fixture(s) rescheduled${rebuilt}`);
      }
    } catch (err) {
      setToast(errorMessage(err, 'Could not check for fixture changes'));
    } finally {
      setFixturesSyncing(false);
    }
  };

  const handleOpenMatchDistribution = async (matchNumber: number) => {
    const predictionId = projections.prediction?.id;
    if (predictionId == null) return;
    setDistribution({ matchNumber, data: null, loading: true, error: null });
    try {
      const data = await api.getMatchDistribution(predictionId, matchNumber);
      setDistribution({ matchNumber, data, loading: false, error: null });
    } catch (err) {
      setDistribution({
        matchNumber,
        data: null,
        loading: false,
        error: errorMessage(err, 'Failed to load match distribution'),
      });
    }
  };

  const switchAppView = (view: AppView) => {
    if (view === appView) return;
    setSelectedMatchNumber(null);
    setAppView(view);
  };

  const openMonteCarlo = () => {
    setMonteCarlo({ running: false, progress: null, result: null, error: null });
    setModal('monteCarlo');
  };

  const openWeekRun = () => {
    setWeekRun(IDLE_WEEK_RUN);
    setModal('week');
  };

  // An empty view should say what to do next, and let the reader do it from here.
  const emptyProjectionMessage = (
    <div className="view-empty">
      <p>No projections yet.</p>
      {publicMode ? (
        <p className="muted">This snapshot was published without a projection.</p>
      ) : (
        <>
          <p className="muted">Run a Monte Carlo batch to build one.</p>
          <button type="button" className="btn btn-simulate" onClick={openMonteCarlo}>
            Run Monte Carlo
          </button>
        </>
      )}
    </div>
  );

  if (loading) {
    return <div className="app-loading">Loading Premier League Simulator…</div>;
  }

  if (fatalError) {
    return (
      <div className="app-error">
        <p className="app-error-title">Could not load the simulator</p>
        <p className="app-error-detail">{fatalError}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        appView={appView}
        publicMode={publicMode}
        activePredictionLabel={
          projections.prediction
            ? predictionLabel(projections.prediction.name, projections.runs)
            : null
        }
        recordedResultCount={actualResults.length}
        nextMatchday={nextMatchday}
        monteCarloRunning={monteCarlo.running}
        weekRunning={weekRun.running}
        onAppViewChange={switchAppView}
        onOpenMonteCarlo={openMonteCarlo}
        onOpenWeekRun={openWeekRun}
        onOpenPredictions={() => setModal('predictions')}
        onOpenRatings={() => setModal('ratings')}
        onSyncFixtures={() => void handleSyncFixtures()}
        fixturesSyncing={fixturesSyncing}
      />

      {toast && (
        <div className="app-toast app-toast-success" role="status">
          <span>{toast}</span>
          <button
            type="button"
            className="app-toast-dismiss"
            aria-label="Dismiss"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="app-toast" role="status">
          <span>{error}</span>
          <button
            type="button"
            className="app-toast-dismiss"
            aria-label="Dismiss"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      <main className="app-main">
        {appView === 'picks' &&
          (projections.prediction == null ? (
            emptyProjectionMessage
          ) : (
            <PicksView
              teams={teams}
              picksState={projections.picks}
              picksError={projections.error}
              loading={projections.loading}
              runs={projections.runs}
              nextMatchday={nextMatchday}
              pickStrategy={pickStrategy}
              savingPickStrategy={savingPickStrategy}
              onPickStrategyChange={
                publicMode
                  ? undefined
                  : (mode) => void handlePickStrategyChange(mode)
              }
              selectedMatchNumber={selectedMatchNumber}
              onSelectMatch={setSelectedMatchNumber}
              onOpenMatch={(matchNumber) => void handleOpenMatchDistribution(matchNumber)}
            />
          ))}

        {appView === 'projections' &&
          (projections.prediction == null ? (
            emptyProjectionMessage
          ) : (
            <ProjectionsView
              projections={projections.teams}
              runs={projections.runs}
              teams={teams}
              nextMatchday={nextMatchday}
              loading={projections.loading}
            />
          ))}

        {appView === 'results' && (
          <ActualResultsView
            teams={teams}
            fixtures={fixtures}
            actualResults={actualResults}
            selectedMatchNumber={selectedMatchNumber}
            nextMatchday={nextMatchday}
            onSelectMatch={setSelectedMatchNumber}
          />
        )}
      </main>

      {publicMode && publicMeta && (
        <footer className="app-footer muted">
          Data exported {new Date(publicMeta.exportedAt).toLocaleString()}
        </footer>
      )}

      {modal === 'predictions' && (
        <PredictionManagerModal
          activePredictionId={projections.prediction?.id ?? null}
          onClose={() => setModal(null)}
          onSwitch={(id) => void switchPrediction(id)}
          onRename={handleRenamePrediction}
          onDelete={handleDeletePrediction}
        />
      )}

      {modal === 'ratings' && (
        <TeamRatingsModal teams={teams} onClose={() => setModal(null)} />
      )}

      {modal === 'monteCarlo' && (
        <MonteCarloModal
          running={monteCarlo.running}
          progress={monteCarlo.progress}
          result={monteCarlo.result}
          error={monteCarlo.error}
          teams={teams}
          upsetVariance={upsetVariance}
          seasonEloDeltaWeight={seasonEloDeltaWeight}
          onUpsetVarianceChange={handleUpsetVarianceChange}
          onSeasonEloDeltaWeightChange={handleSeasonEloDeltaWeightChange}
          onResetRunParameters={handleResetRunParameters}
          onClose={() => {
            if (!monteCarlo.running) setModal(null);
          }}
          onRun={(runs, name) => void handleRunMonteCarlo(runs, name)}
          onOpenProjections={() => {
            setModal(null);
            switchAppView('projections');
          }}
        />
      )}

      {modal === 'week' && (
        <WeekRunModal
          state={weekRun}
          teams={teams}
          nextMatchday={nextMatchday}
          onClose={() => {
            if (!weekRun.running) setModal(null);
          }}
          onRun={(options) => void handleRunWeek(options)}
          onOpenProjections={() => {
            setModal(null);
            switchAppView('projections');
          }}
        />
      )}

      {distribution && distributionMatch && (
        <MatchDistributionModal
          match={distributionMatch}
          distribution={distribution.data}
          loading={distribution.loading}
          error={distribution.error}
          onClose={() => setDistribution(null)}
        />
      )}
    </div>
  );
}
