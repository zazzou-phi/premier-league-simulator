import { useEffect, useState } from 'react';
import { SCORING_RULES_HINT } from '../lib/pickStrategy.js';

interface Props {
  exactScore: number;
  correctResult: number;
  disabled?: boolean;
  onChange: (points: { exactScore: number; correctResult: number }) => void;
}

/**
 * The payoff the `maxPoints` strategy optimises against. Only the ratio of the two matters,
 * so the pair is committed together rather than each field writing on its own keystroke.
 */
export function ScoringRulesControl({
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
    <div className="scoring-rules" role="group" aria-label="Predictor scoring">
      <div className="scoring-rules-fields">
        <label className="scoring-rules-field">
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
        <label className="scoring-rules-field">
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
        <p className="muted scoring-rules-hint">{SCORING_RULES_HINT}</p>
      ) : (
        <p className="modal-warning scoring-rules-hint">
          An exact score cannot pay less than a correct result.
        </p>
      )}
    </div>
  );
}
