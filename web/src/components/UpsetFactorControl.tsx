import {
  DEFAULT_UPSET_VARIANCE,
  UPSET_FACTOR_HINT,
  UPSET_VARIANCE_MAX,
} from '../lib/upsetVariance.js';

interface Props {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  variant?: 'compact' | 'full';
  id?: string;
}

export function UpsetFactorControl({
  value,
  disabled = false,
  onChange,
  variant = 'compact',
  id = 'upset-factor',
}: Props) {
  const displayValue = value.toFixed(2);

  if (variant === 'compact') {
    return (
      <div className="upset-factor upset-factor-compact" title={UPSET_FACTOR_HINT}>
        <label className="upset-factor-label" htmlFor={id} title={UPSET_FACTOR_HINT}>
          Upset <span className="upset-factor-value">{displayValue}</span>
        </label>
        <input
          id={id}
          className="upset-factor-range"
          type="range"
          min={0}
          max={UPSET_VARIANCE_MAX}
          step={0.05}
          value={value}
          disabled={disabled}
          title={UPSET_FACTOR_HINT}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="upset-factor upset-factor-full">
      <label className="modal-label" htmlFor={id} title={UPSET_FACTOR_HINT}>
        Upset factor <span className="muted upset-factor-value">{displayValue}</span>
      </label>
      <input
        id={id}
        className="modal-range"
        type="range"
        min={0}
        max={UPSET_VARIANCE_MAX}
        step={0.05}
        value={value}
        disabled={disabled}
        title={UPSET_FACTOR_HINT}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <p className="muted upset-factor-hint">{UPSET_FACTOR_HINT}</p>
    </div>
  );
}

export { DEFAULT_UPSET_VARIANCE };
