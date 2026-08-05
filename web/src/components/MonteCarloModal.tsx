import { useEffect, useState } from 'react';
import { MONTE_CARLO_MAX_RUNS } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { readRunRate, writeRunRate } from '../lib/runRate.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from '../lib/seasonForm.js';
import { DEFAULT_UPSET_VARIANCE } from '../lib/upsetVariance.js';
import type { MonteCarloRunResult } from '../types.js';
import { Modal } from './Modal.js';
import { ProjectionsTable } from './ProjectionsTable.js';
import { SeasonFormControl } from './SeasonFormControl.js';
import { UpsetFactorControl } from './UpsetFactorControl.js';

interface Props {
  running: boolean;
  progress: { completed: number; total: number } | null;
  result: MonteCarloRunResult | null;
  error: string | null;
  teams: Team[];
  upsetVariance: number;
  seasonEloDeltaWeight: number;
  onUpsetVarianceChange: (value: number) => void;
  onSeasonEloDeltaWeightChange: (value: number) => void;
  onResetRunParameters: () => void;
  onClose: () => void;
  onRun: (runs: number, name: string) => void;
  onOpenProjections: () => void;
}

/** A weekly batch, a confident batch, and an overnight one. */
const RUN_PRESETS = [1_000, 5_000, 25_000];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function MonteCarloModal({
  running,
  progress,
  result,
  error,
  teams,
  upsetVariance,
  seasonEloDeltaWeight,
  onUpsetVarianceChange,
  onSeasonEloDeltaWeightChange,
  onResetRunParameters,
  onClose,
  onRun,
  onOpenProjections,
}: Props) {
  const [runsInput, setRunsInput] = useState('1000');
  const [nameInput, setNameInput] = useState('');
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [msPerRun, setMsPerRun] = useState<number | null>(() => readRunRate());

  useEffect(() => {
    setRunStartedAt(running ? performance.now() : null);
  }, [running]);

  // Cost the next batch from the last one that actually finished on this machine.
  useEffect(() => {
    if (!result) return;
    writeRunRate(result.elapsedMs, result.runs);
    setMsPerRun(result.elapsedMs / result.runs);
  }, [result]);

  const parsedRuns = Number.parseInt(runsInput, 10);
  const runsValid =
    Number.isInteger(parsedRuns) && parsedRuns >= 1 && parsedRuns <= MONTE_CARLO_MAX_RUNS;
  const estimate = msPerRun != null && runsValid ? msPerRun * parsedRuns : null;

  const atDefaults =
    upsetVariance === DEFAULT_UPSET_VARIANCE &&
    seasonEloDeltaWeight === DEFAULT_SEASON_ELO_DELTA_WEIGHT;

  const handleRun = () => {
    if (!runsValid) return;
    onRun(parsedRuns, nameInput.trim() || `Monte Carlo ${parsedRuns.toLocaleString()}`);
  };

  return (
    <Modal className="modal modal-wide" titleId="monte-carlo-title" onClose={onClose}>
      <h2 id="monte-carlo-title">Monte Carlo season simulation</h2>
      <p className="muted monte-carlo-desc">
        Play many complete seasons using current team ratings, replaying any recorded results.
        Only the aggregate distribution is kept, and it is saved as a projection you can open
        later.
      </p>

      <label className="modal-label" htmlFor="monte-carlo-runs">
        Number of seasons
      </label>
      <div className="run-count-field">
        <input
          id="monte-carlo-runs"
          className="modal-input run-count-input"
          type="number"
          min={1}
          max={MONTE_CARLO_MAX_RUNS}
          step={1}
          value={runsInput}
          disabled={running}
          onChange={(e) => setRunsInput(e.target.value)}
        />
        <div className="run-count-presets">
          {RUN_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`btn btn-ghost btn-small ${parsedRuns === preset ? 'active' : ''}`}
              disabled={running}
              aria-pressed={parsedRuns === preset}
              onClick={() => setRunsInput(String(preset))}
            >
              {preset.toLocaleString()}
            </button>
          ))}
        </div>
      </div>
      {/* Shown only once a batch has actually completed here — the cost is machine-specific,
          so there is no sensible default to guess from. */}
      <p className="muted modal-hint run-count-estimate">
        {estimate == null
          ? 'Run once to learn how long a season takes on this machine.'
          : `About ${formatDuration(estimate)} at the last run's speed.`}
      </p>

      <label className="modal-label" htmlFor="monte-carlo-name">
        Projection name
      </label>
      <input
        id="monte-carlo-name"
        className="modal-input"
        type="text"
        placeholder="Monte Carlo 1,000"
        value={nameInput}
        disabled={running}
        onChange={(e) => setNameInput(e.target.value)}
      />

      {/* Both parameters are read at simulation time and change nothing on screen, so they
          belong with the Run button rather than in a header menu styled as a live filter. */}
      <div className="run-parameters">
        <div className="run-parameters-head">
          <h3 className="run-parameters-title">Run parameters</h3>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={running || atDefaults}
            onClick={onResetRunParameters}
          >
            Reset to defaults
          </button>
        </div>
        <UpsetFactorControl
          id="monte-carlo-upset"
          value={upsetVariance}
          disabled={running}
          onChange={onUpsetVarianceChange}
        />
        <SeasonFormControl
          id="monte-carlo-season-form"
          value={seasonEloDeltaWeight}
          disabled={running}
          onChange={onSeasonEloDeltaWeightChange}
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-simulate" disabled={running} onClick={handleRun}>
          {running ? 'Simulating…' : 'Run'}
        </button>
        {result && (
          <button type="button" className="btn" disabled={running} onClick={onOpenProjections}>
            Open in Projections
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={running} onClick={onClose}>
          Close
        </button>
      </div>

      {running && progress && (
        <div className="monte-carlo-progress" aria-live="polite">
          <div className="monte-carlo-progress-header">
            <span>
              {progress.completed.toLocaleString()} / {progress.total.toLocaleString()} seasons
            </span>
            <span>{Math.round((progress.completed / progress.total) * 100)}%</span>
          </div>
          <div
            className="monte-carlo-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
          >
            <div
              className="monte-carlo-progress-fill"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
          {progress.completed > 0 && runStartedAt != null && (
            <p className="muted monte-carlo-progress-eta">
              About{' '}
              {formatDuration(
                ((performance.now() - runStartedAt) / progress.completed) *
                  (progress.total - progress.completed),
              )}{' '}
              remaining
            </p>
          )}
        </div>
      )}

      {error && <p className="modal-warning">{error}</p>}

      {result && (
        <div className="monte-carlo-results">
          <p className="monte-carlo-summary">
            Simulated {result.runs.toLocaleString()} seasons in {formatDuration(result.elapsedMs)}
          </p>
          <ProjectionsTable
            projections={result.teams}
            runs={result.runs}
            teams={teams}
            showDistribution={false}
          />
        </div>
      )}
    </Modal>
  );
}
