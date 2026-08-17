import { useEffect, useState } from 'react';
import { PREDICTOR_POINTS_HINT } from '../lib/consensusMode.js';

interface Props {
  exactScore: number;
  correctResult: number;
  disabled?: boolean;
  onChange: (points: { exactScore: number; correctResult: number }) => void;
}

/**
 * The payoff `expectedPoints` consensus optimises against. Only the ratio of the two matters,
 * so the pair is committed together rather than each field writing on its own keystroke.
 */
export function PredictorPointsControl({
  exactScore,
  correctResult,
  disabled = false,
  onChange,
}: Props) {
  const [exact, setExact] = useState(String(exactScore));
  const [result, setResult] = useState(String(correctResult));

  // Re-sync when the batch changes underneath us, or a rejected edit has to be rolled back.
  useEffect(() => setExact(String(exactScore)), [exactScore]);
  useEffect(() => setResult(String(correctResult)), [correctResult]);

  const parsedExact = Number(exact);
  const parsedResult = Number(result);
  const valid =
    Number.isFinite(parsedExact) &&
    Number.isFinite(parsedResult) &&
    parsedExact >= parsedResult &&
    parsedResult >= 0;
  const dirty = parsedExact !== exactScore || parsedResult !== correctResult;

  const commit = () => {
    if (!valid || !dirty) return;
    onChange({ exactScore: parsedExact, correctResult: parsedResult });
  };

  return (
    <div className="predictor-points" role="group" aria-label="Predictor scoring">
      <div className="predictor-points-fields">
        <label className="predictor-points-field">
          <span className="muted">Exact score</span>
          <input
            type="number"
            min={0}
            step={1}
            value={exact}
            disabled={disabled}
            onChange={(e) => setExact(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </label>
        <label className="predictor-points-field">
          <span className="muted">Correct result</span>
          <input
            type="number"
            min={0}
            step={1}
            value={result}
            disabled={disabled}
            onChange={(e) => setResult(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={disabled || !valid || !dirty}
          onClick={commit}
        >
          Apply
        </button>
      </div>
      {valid ? (
        <p className="muted predictor-points-hint">{PREDICTOR_POINTS_HINT}</p>
      ) : (
        <p className="modal-warning predictor-points-hint">
          An exact score cannot pay less than a correct result.
        </p>
      )}
    </div>
  );
}
