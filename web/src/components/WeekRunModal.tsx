import { useEffect, useState } from 'react';
import { MONTE_CARLO_MAX_RUNS } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import type { WeekRunOptions } from '../api/client.js';
import { readRunRate, writeRunRate } from '../lib/runRate.js';
import type { WeekRunState, WeekStepEntry } from '../lib/weekRunLog.js';
import type { PredictionAccuracy, WeekStepResult } from '../types.js';
import { Modal } from './Modal.js';
import { PredictionAccuracySummary } from './PredictionAccuracy.js';
import { ProjectionsTable } from './ProjectionsTable.js';

interface Props {
  state: WeekRunState;
  teams: Team[];
  /** Lowest matchday still unplayed, for the default projection name. */
  nextMatchday: number | null;
  onClose: () => void;
  onRun: (options: WeekRunOptions) => void;
  onOpenProjections: () => void;
}

/** A quick weekly refresh, the default, and a confident one. */
const RUN_PRESETS = [1_000, 10_000, 25_000];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function defaultName(nextMatchday: number | null): string {
  const today = new Date().toISOString().slice(0, 10);
  return nextMatchday == null ? `Final · ${today}` : `MD${nextMatchday} · ${today}`;
}

/** What a finished step reported, in one or two lines under its label. */
function StepDetail({
  result,
  teams,
  dryRun,
}: {
  result: WeekStepResult;
  teams: Team[];
  dryRun: boolean;
}) {
  switch (result.step) {
    case 'results': {
      const { applied, overwritten, unchanged, localActuals } = result.results;
      return (
        <p className="week-step-detail">
          {applied} newly locked · {overwritten} changed · {unchanged} unchanged ·{' '}
          <span className="muted">{localActuals} locked in total</span>
        </p>
      );
    }

    case 'ratings': {
      if (!result.ratings) return <p className="week-step-detail muted">Skipped.</p>;
      const { updated, unchanged, asOf, movers } = result.ratings;
      return (
        <>
          <p className="week-step-detail">
            {updated} ratings changed · {unchanged} unchanged{' '}
            <span className="muted">(as of {asOf})</span>
          </p>
          {movers && movers.length > 0 && (
            <ul className="week-movers">
              {movers.map((mover) => (
                <li key={mover.teamId}>
                  <span className="week-mover-name">{mover.name}</span>
                  <span className="week-mover-elo">
                    {mover.from.toFixed(0)} → {mover.to.toFixed(0)}
                  </span>
                  <span className={mover.delta >= 0 ? 'accuracy-good' : 'accuracy-bad'}>
                    {mover.delta >= 0 ? '+' : ''}
                    {mover.delta.toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    }

    case 'grading': {
      if (!result.graded) {
        return (
          <p className="week-step-detail muted">
            No earlier projection has gradeable results yet.
          </p>
        );
      }
      return (
        <>
          <p className="week-step-detail">{result.graded.prediction.name}</p>
          <PredictionAccuracySummary
            accuracy={result.graded.accuracy as PredictionAccuracy}
            loading={false}
          />
        </>
      );
    }

    case 'projection': {
      const projection = result.projection;
      if (projection.skipped === 'season-complete') {
        return (
          <p className="week-step-detail muted">
            Every fixture is locked — the season is complete, nothing left to project.
          </p>
        );
      }
      if (projection.skipped === 'dry-run') {
        return (
          <p className="week-step-detail muted">
            Would run {(projection.runs ?? 0).toLocaleString()} seasons and save as “
            {projection.name}”.
          </p>
        );
      }
      return (
        <>
          <p className="week-step-detail">
            {(projection.runs ?? 0).toLocaleString()} seasons in{' '}
            {formatDuration(projection.elapsedMs ?? 0)}{' '}
            <span className="muted">→ projection #{projection.predictionId}</span>
          </p>
          {projection.teams && (
            <div className="week-projection-table">
              <ProjectionsTable
                projections={projection.teams}
                runs={projection.runs ?? 0}
                teams={teams}
                showDistribution={false}
              />
            </div>
          )}
        </>
      );
    }

    case 'export':
      return (
        <p className="week-step-detail">
          {dryRun && <span className="muted">Would write JSON snapshots to </span>}
          <code className="week-path">{result.export.dir}</code>{' '}
          <span className="muted">(reveal policy: {result.export.revealPolicy})</span>
        </p>
      );
  }
}

function StepRow({
  entry,
  running,
  progress,
  teams,
  dryRun,
}: {
  entry: WeekStepEntry;
  running: boolean;
  progress: WeekRunState['progress'];
  teams: Team[];
  dryRun: boolean;
}) {
  const done = entry.result != null;
  const active = running && !done;

  return (
    <li className={`week-step ${done ? 'week-step-done' : ''} ${active ? 'week-step-active' : ''}`}>
      <div className="week-step-head">
        <span className="week-step-marker" aria-hidden="true">
          {done ? '✓' : active ? '▸' : '·'}
        </span>
        <span className="week-step-label">{entry.label}</span>
      </div>
      {active && progress && (
        <div className="monte-carlo-progress week-step-progress">
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
        </div>
      )}
      {entry.result && <StepDetail result={entry.result} teams={teams} dryRun={dryRun} />}
    </li>
  );
}

/**
 * `npm run week` in the browser. The steps, their order and their wording all come from the
 * server as the run streams, so this is a rendering of the loop rather than a second copy of it.
 */
export function WeekRunModal({
  state,
  teams,
  nextMatchday,
  onClose,
  onRun,
  onOpenProjections,
}: Props) {
  const [runsInput, setRunsInput] = useState('10000');
  const [nameInput, setNameInput] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [skipRatings, setSkipRatings] = useState(false);
  const [skipExport, setSkipExport] = useState(false);
  const [msPerRun, setMsPerRun] = useState<number | null>(() => readRunRate());

  const projection = state.result?.projection;

  // The projection step is an ordinary Monte Carlo batch, so it costs the next one too.
  useEffect(() => {
    if (!projection?.runs || !projection.elapsedMs) return;
    writeRunRate(projection.elapsedMs, projection.runs);
    setMsPerRun(projection.elapsedMs / projection.runs);
  }, [projection]);

  const parsedRuns = Number.parseInt(runsInput, 10);
  const runsValid =
    Number.isInteger(parsedRuns) && parsedRuns >= 1 && parsedRuns <= MONTE_CARLO_MAX_RUNS;
  const estimate = msPerRun != null && runsValid ? msPerRun * parsedRuns : null;
  const running = state.running;

  const options: WeekRunOptions = {
    runs: parsedRuns,
    name: nameInput.trim() || undefined,
    dryRun,
    skipRatings,
    skipExport,
  };

  const stepCount = state.totalSteps ?? (skipExport ? 4 : 5);
  // The step that was in flight when the run failed: the last one that never reported back.
  const failedStep = state.steps.find((entry) => entry.result == null)?.step ?? null;

  return (
    <Modal className="modal modal-wide week-modal" titleId="week-run-title" onClose={onClose}>
      <h2 id="week-run-title">Advance the season by one week</h2>
      <p className="muted monte-carlo-desc">
        Pulls the weekend's results, updates ratings from them, grades the projection those results
        just settled, re-projects the rest of the season and re-exports the public snapshot —
        in that order, because projecting before the results are in would ignore the weekend.
      </p>

      <label className="modal-label" htmlFor="week-runs">
        Seasons to simulate
      </label>
      <div className="run-count-field">
        <input
          id="week-runs"
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
      <p className="muted modal-hint run-count-estimate">
        {estimate == null
          ? 'Run once to learn how long a season takes on this machine.'
          : `About ${formatDuration(estimate)} at the last run's speed.`}
      </p>

      <label className="modal-label" htmlFor="week-name">
        Projection name
      </label>
      <input
        id="week-name"
        className="modal-input"
        type="text"
        placeholder={defaultName(nextMatchday)}
        value={nameInput}
        disabled={running}
        onChange={(e) => setNameInput(e.target.value)}
      />

      <div className="week-options" role="group" aria-label="Run options">
        <label className="week-option">
          <input
            type="checkbox"
            checked={dryRun}
            disabled={running}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          <span>
            Dry run
            <span className="muted week-option-hint">
              Report what would change; write nothing
            </span>
          </span>
        </label>
        <label className="week-option">
          <input
            type="checkbox"
            checked={skipRatings}
            disabled={running}
            onChange={(e) => setSkipRatings(e.target.checked)}
          />
          <span>
            Skip the ratings update
            <span className="muted week-option-hint">Keep the ratings the model has now</span>
          </span>
        </label>
        <label className="week-option">
          <input
            type="checkbox"
            checked={skipExport}
            disabled={running}
            onChange={(e) => setSkipExport(e.target.checked)}
          />
          <span>
            Skip the public snapshot
            <span className="muted week-option-hint">
              Leave <code className="week-path">web/public/data</code> as it is
            </span>
          </span>
        </label>
      </div>

      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-simulate"
          disabled={running || !runsValid}
          onClick={() => onRun(options)}
        >
          {running ? 'Running…' : dryRun ? 'Preview the week' : 'Run the week'}
        </button>
        {projection?.predictionId != null && (
          <button type="button" className="btn" disabled={running} onClick={onOpenProjections}>
            Open in Projections
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={running} onClick={onClose}>
          Close
        </button>
      </div>

      {state.error && (
        <div className="week-error">
          <p className="modal-warning">{state.error}</p>
          {state.errorCode === 'REMOTE_RESULTS_CHANGED' && (
            <>
              <p className="muted modal-hint">
                That is usually a corrected scoreline, but accepting it rewrites recorded
                history and the grades of every past projection.
              </p>
              <button
                type="button"
                className="btn btn-danger"
                disabled={running}
                onClick={() => onRun({ ...options, force: true })}
              >
                Re-run and accept the changes
              </button>
            </>
          )}
          {/* Only the Elo refresh is optional. When it is the step that could not reach its
              feed, the rest of the week can still run without it. */}
          {state.errorCode === 'REMOTE_UNREACHABLE' && failedStep === 'ratings' && (
            <>
              <p className="muted modal-hint">
                The ratings the model has now stay in place, and the weekend is already synced.
              </p>
              <button
                type="button"
                className="btn"
                disabled={running}
                onClick={() => {
                  setSkipRatings(true);
                  onRun({ ...options, skipRatings: true });
                }}
              >
                Re-run without the ratings update
              </button>
            </>
          )}
        </div>
      )}

      {state.steps.length > 0 && (
        <ol className="week-steps" aria-live="polite">
          {state.steps.map((entry) => (
            <StepRow
              key={entry.step}
              entry={entry}
              running={running}
              progress={state.progress}
              teams={teams}
              dryRun={state.dryRun}
            />
          ))}
        </ol>
      )}

      {state.steps.length > 0 && (
        <p className="muted modal-hint">
          {state.running
            ? `Step ${state.steps.length} of ${stepCount}.`
            : state.result?.dryRun
              ? 'Dry run — nothing was written. Clear "Dry run" to apply it.'
              : state.result
                ? 'Done. The database is gitignored, so commit data/teams.csv and data/fixtures.csv — they are the recoverable record of what was known this week.'
                : null}
        </p>
      )}
    </Modal>
  );
}
