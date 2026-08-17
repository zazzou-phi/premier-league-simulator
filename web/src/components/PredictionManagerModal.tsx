import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { formatPickStrategy } from '../lib/pickStrategy.js';
import type { AccuracyHistoryPoint, Prediction, PredictionAccuracy } from '../types.js';
import {
  AccuracyTrend,
  PredictionAccuracyPanel,
  PredictionAccuracySummary,
} from './PredictionAccuracy.js';
import { Modal } from './Modal.js';

const PAGE_SIZE = 50;

interface Props {
  activePredictionId: number | null;
  onClose: () => void;
  onSwitch: (id: number) => void;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'rename'; id: number }
  | { kind: 'delete'; id: number; name: string }
  | { kind: 'accuracy'; id: number; name: string };

export function PredictionManagerModal({
  activePredictionId,
  onClose,
  onSwitch,
  onRename,
  onDelete,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [selectedId, setSelectedId] = useState<number | null>(activePredictionId);
  const [nameInput, setNameInput] = useState('');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<PredictionAccuracy | null>(null);
  const [accuracyLoading, setAccuracyLoading] = useState(false);
  const [accuracyHistory, setAccuracyHistory] = useState<AccuracyHistoryPoint[]>([]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listPredictions(nextPage, PAGE_SIZE);
      setPredictions(result.items);
      setTotal(result.total);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  // Grading every projection is a handful of queries each, so load the trend once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const history = await api.getAccuracyHistory();
        if (!cancelled) setAccuracyHistory(history);
      } catch {
        if (!cancelled) setAccuracyHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedId(activePredictionId);
  }, [activePredictionId]);

  // Grade whichever projection is highlighted. Stale responses are discarded so a slow
  // request for a previous selection cannot overwrite a newer one.
  useEffect(() => {
    if (selectedId == null) {
      setAccuracy(null);
      return;
    }
    let cancelled = false;
    setAccuracyLoading(true);
    void (async () => {
      try {
        const result = await api.getPredictionAccuracy(selectedId);
        if (!cancelled) setAccuracy(result);
      } catch {
        if (!cancelled) setAccuracy(null);
      } finally {
        if (!cancelled) setAccuracyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleSubmitName = () => {
    if (mode.kind !== 'rename') return;
    const id = mode.id;
    void (async () => {
      try {
        await onRename(id, nameInput.trim() || 'Projection');
        setMode({ kind: 'list' });
        setNameInput('');
        await loadPage(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename projection');
      }
    })();
  };

  const selectedPrediction = predictions.find((prediction) => prediction.id === selectedId);

  return (
    <Modal className="modal" titleId="prediction-manager-title" onClose={onClose}>
      <h2 id="prediction-manager-title">Projections</h2>

      {mode.kind === 'list' && (
        <>
          <div className="sim-list">
            {loading ? (
              <p className="muted sim-list-status">Loading…</p>
            ) : error ? (
              <p className="modal-warning sim-list-status">{error}</p>
            ) : predictions.length === 0 ? (
              <p className="muted sim-list-status">
                No projections yet — run a Monte Carlo batch from the Simulation view.
              </p>
            ) : (
              predictions.map((prediction) => (
                <div
                  key={prediction.id}
                  className={`sim-row ${prediction.id === selectedId ? 'selected' : ''} ${
                    prediction.id === activePredictionId ? 'active' : ''
                  }`}
                  onClick={() => setSelectedId(prediction.id)}
                  onDoubleClick={() => onSwitch(prediction.id)}
                >
                  <span className="sim-id">#{prediction.id}</span>
                  <span className="sim-name">{prediction.name}</span>
                  <span className="sim-meta">
                    {prediction.asOfMatchday != null
                      ? `from MD${prediction.asOfMatchday}`
                      : formatPickStrategy(prediction.pickStrategy)}
                  </span>
                  <span className="sim-meta sim-count">
                    {prediction.runs.toLocaleString()} runs
                  </span>
                  {prediction.id === activePredictionId && <span className="sim-current">*</span>}
                </div>
              ))
            )}
          </div>
          {selectedPrediction && (
            <PredictionAccuracySummary accuracy={accuracy} loading={accuracyLoading} />
          )}
          {total > PAGE_SIZE && (
            <div className="sim-pagination">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={loading || page <= 1}
                onClick={() => void loadPage(page - 1)}
              >
                Previous
              </button>
              <span className="sim-pagination-meta muted">
                Page {page} of {totalPages} ({total.toLocaleString()} total)
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={loading || page >= totalPages}
                onClick={() => void loadPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              disabled={selectedId == null}
              onClick={() => selectedId != null && onSwitch(selectedId)}
            >
              Open
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!selectedPrediction || !accuracy}
              onClick={() => {
                if (!selectedPrediction) return;
                setMode({
                  kind: 'accuracy',
                  id: selectedPrediction.id,
                  name: selectedPrediction.name,
                });
              }}
            >
              Accuracy
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!selectedPrediction}
              onClick={() => {
                if (!selectedPrediction) return;
                setMode({ kind: 'rename', id: selectedPrediction.id });
                setNameInput(selectedPrediction.name);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!selectedPrediction}
              onClick={() => {
                if (!selectedPrediction) return;
                setMode({
                  kind: 'delete',
                  id: selectedPrediction.id,
                  name: selectedPrediction.name,
                });
              }}
            >
              Delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}

      {mode.kind === 'accuracy' && (
        <>
          <p className="accuracy-heading">
            #{mode.id} {mode.name}
          </p>
          {accuracy ? (
            <>
              <AccuracyTrend history={accuracyHistory} />
              <PredictionAccuracyPanel accuracy={accuracy} />
            </>
          ) : (
            <p className="muted">Grading…</p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setMode({ kind: 'list' })}
            >
              Back
            </button>
          </div>
        </>
      )}

      {mode.kind === 'rename' && (
        <>
          <label className="modal-label" htmlFor="prediction-name">
            Rename projection
          </label>
          <input
            id="prediction-name"
            className="modal-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmitName();
              if (e.key === 'Escape') {
                // Back out of renaming only. Without this the dialog's own Escape handler
                // would see the event and close the whole modal.
                e.stopPropagation();
                setMode({ kind: 'list' });
              }
            }}
            autoFocus
          />
          <div className="modal-actions">
            <button type="button" className="btn" onClick={handleSubmitName}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setMode({ kind: 'list' })}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {mode.kind === 'delete' && (
        <>
          <p className="modal-warning">Delete projection #{mode.id}?</p>
          <p>{mode.name}</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                void (async () => {
                  try {
                    await onDelete(mode.id);
                    setMode({ kind: 'list' });
                    await loadPage(predictions.length === 1 && page > 1 ? page - 1 : page);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to delete projection');
                    setMode({ kind: 'list' });
                  }
                })();
              }}
            >
              Confirm delete
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setMode({ kind: 'list' })}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
