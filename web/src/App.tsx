import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findNextMatchday } from '@shared/engine/schedule.js';
import type { MatchDistribution, TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type {
  ActualMatchResult,
  Fixture,
  SeasonState,
  Team,
} from '@shared/engine/types.js';
import { api, isPublicMode } from './api/client.js';
import { loadPublicMeta } from './api/staticClient.js';
import { ActualResultsView } from './components/ActualResultsView.js';
import { ConsensusView } from './components/ConsensusView.js';
import { Header } from './components/Header.js';
import { MatchDistributionModal } from './components/MatchDistributionModal.js';
import { MonteCarloModal } from './components/MonteCarloModal.js';
import { PredictionManagerModal } from './components/PredictionManagerModal.js';
import { ProjectionsView } from './components/ProjectionsView.js';
import { TeamRatingsModal } from './components/TeamRatingsModal.js';
import type { AppView } from './lib/appView.js';
import { DEFAULT_CONSENSUS_MODE, type ConsensusMode } from './lib/consensusMode.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from './lib/seasonForm.js';
import { DEFAULT_UPSET_VARIANCE } from './lib/upsetVariance.js';
import type { MonteCarloRunResult, Prediction, PublicMeta } from './types.js';

type ModalKind = 'predictions' | 'ratings' | 'monteCarlo' | null;

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
  consensus: SeasonState | null;
  error: string | null;
  loading: boolean;
}

const EMPTY_PROJECTIONS: ProjectionState = {
  prediction: null,
  runs: 0,
  teams: [],
  consensus: null,
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

  // The forecast is the answer the engine exists to compute, so it leads. Bootstrap falls back to
  // the consensus season when there is no batch to project from.
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

  const [savingConsensusMode, setSavingConsensusMode] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloState>({
    running: false,
    progress: null,
    result: null,
    error: null,
  });
  const [distribution, setDistribution] = useState<DistributionState | null>(null);

  const loadProjection = useCallback(async (prediction: Prediction) => {
    setProjections((prev) => ({ ...prev, prediction, loading: true, error: null }));
    try {
      const [projectionData, consensus] = await Promise.all([
        api.getPredictionProjections(prediction.id),
        api.getPredictionState(prediction.id).catch(() => null),
      ]);
      setProjections({
        prediction,
        runs: projectionData.runs,
        teams: projectionData.teams,
        consensus,
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
            setAppView('consensus');
          } else {
            await loadProjection({
              id: meta.predictionId,
              name: meta.predictionName ?? 'Season',
              runs: meta.runs,
              consensusMode: DEFAULT_CONSENSUS_MODE,
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
          else setAppView('consensus');
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

  const consensusMode = projections.prediction?.consensusMode ?? DEFAULT_CONSENSUS_MODE;

  // Same rule the engine uses for naming projections, so header and CLI never disagree.
  const nextMatchday = useMemo(
    () => findNextMatchday(fixtures, new Set(actualResults.map((r) => r.matchNumber))),
    [fixtures, actualResults],
  );

  const distributionMatch = useMemo(() => {
    if (!distribution || !projections.consensus) return null;
    return (
      projections.consensus.matches.find(
        (match) => match.fixture.matchNumber === distribution.matchNumber,
      ) ?? null
    );
  }, [distribution, projections.consensus]);

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

  const handleConsensusModeChange = async (mode: ConsensusMode) => {
    const prediction = projections.prediction;
    if (!prediction) return;
    setError(null);
    setSavingConsensusMode(true);
    try {
      const updated = await api.setPredictionConsensusMode(prediction.id, mode);
      const consensus = await api.getPredictionState(prediction.id).catch(() => null);
      setProjections((prev) => ({ ...prev, prediction: updated, consensus }));
      setToast(`Consensus scorelines set to ${mode}`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to update consensus mode'));
    } finally {
      setSavingConsensusMode(false);
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
            ? `${projections.prediction.name} · ${projections.runs.toLocaleString()} runs`
            : null
        }
        recordedResultCount={actualResults.length}
        nextMatchday={nextMatchday}
        monteCarloRunning={monteCarlo.running}
        onAppViewChange={switchAppView}
        onOpenMonteCarlo={openMonteCarlo}
        onOpenPredictions={() => setModal('predictions')}
        onOpenRatings={() => setModal('ratings')}
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
        {appView === 'consensus' &&
          (projections.prediction == null ? (
            emptyProjectionMessage
          ) : (
            <ConsensusView
              teams={teams}
              consensusState={projections.consensus}
              consensusError={projections.error}
              loading={projections.loading}
              runs={projections.runs}
              nextMatchday={nextMatchday}
              consensusMode={consensusMode}
              savingConsensusMode={savingConsensusMode}
              onConsensusModeChange={
                publicMode
                  ? undefined
                  : (mode) => void handleConsensusModeChange(mode)
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
