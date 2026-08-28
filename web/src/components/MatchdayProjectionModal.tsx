import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { formatPickStrategy } from '../lib/pickStrategy.js';
import type { MatchdayProjection, MatchdayProjectionOptions } from '../types.js';
import { Modal } from './Modal.js';

interface Props {
  matchday: number;
  onClose: () => void;
  /** Applied after the pin lands, so the caller can reload the season it just changed. */
  onChanged: (projection: MatchdayProjection) => void;
}

/**
 * Which projection a matchday is read through.
 *
 * The weekly loop runs a batch a round, and each one is handed the results that landed before
 * it — so the newest batch has no forecast for a round already played, only a replay of it.
 * Attaching a round to the batch that faced it blind is what puts a pick back beside the
 * result it was aiming at, and comparing two batches on the same round is what shows whether
 * the model moved.
 */
export function MatchdayProjectionModal({ matchday, onClose, onChanged }: Props) {
  const [options, setOptions] = useState<MatchdayProjectionOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOptions(await api.getMatchdayProjectionOptions(matchday));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projections');
    } finally {
      setLoading(false);
    }
  }, [matchday]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = (action: () => Promise<MatchdayProjection>) => {
    setSaving(true);
    setError(null);
    void (async () => {
      try {
        onChanged(await action());
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to attach the projection');
        setSaving(false);
      }
    })();
  };

  const current = options?.current ?? null;

  return (
    <Modal className="modal" titleId="matchday-projection-title" onClose={onClose}>
      <h2 id="matchday-projection-title">Matchday {matchday} projection</h2>
      <p className="muted modal-hint">
        Which batch supplies this round&rsquo;s picked scorelines and the spread behind them.
      </p>

      {loading ? (
        <p className="muted sim-list-status">Loading…</p>
      ) : (
        <>
          {error && <p className="modal-warning">{error}</p>}
          <div className="sim-list">
            <div
              className={`sim-row matchday-projection-auto ${current?.pinned === false ? 'selected' : ''}`}
              onClick={() => !saving && apply(() => api.clearMatchdayProjection(matchday))}
            >
              <span className="sim-id">Auto</span>
              <span className="sim-name">
                Latest batch that forecast matchday {matchday}
                {current && !current.pinned && current.name ? ` — ${current.name}` : ''}
              </span>
              <span className="sim-meta">follows the season</span>
            </div>

            {(options?.candidates ?? []).map((candidate) => (
              <div
                key={candidate.id}
                className={`sim-row ${current?.pinned && current.predictionId === candidate.id ? 'selected' : ''} ${
                  candidate.id === current?.predictionId ? 'active' : ''
                }`}
                title={
                  candidate.forecast
                    ? `Projected ${candidate.runs.toLocaleString()} seasons, ${formatPickStrategy(candidate.pickStrategy).toLowerCase()} scorelines`
                    : `This batch ran after matchday ${matchday} was played, so it was handed those results rather than forecasting them — it has no picks to show for this round`
                }
                onClick={() =>
                  !saving && apply(() => api.pinMatchdayProjection(matchday, candidate.id))
                }
              >
                <span className="sim-id">#{candidate.id}</span>
                <span className="sim-name">{candidate.name}</span>
                <span className="sim-meta">
                  {candidate.forecast ? (
                    candidate.asOfMatchday != null ? (
                      `from MD${candidate.asOfMatchday}`
                    ) : (
                      formatPickStrategy(candidate.pickStrategy)
                    )
                  ) : (
                    <span className="matchday-projection-blind">no forecast</span>
                  )}
                </span>
                <span className="sim-meta sim-count">{candidate.runs.toLocaleString()} runs</span>
                {candidate.id === current?.predictionId && <span className="sim-current">*</span>}
              </div>
            ))}
          </div>

          {options?.candidates.length === 0 && (
            <p className="muted sim-list-status">
              No projections yet — run a Monte Carlo batch first.
            </p>
          )}
        </>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
