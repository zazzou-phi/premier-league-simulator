import {
  DEFAULT_UPSET_VARIANCE,
  UPSET_FACTOR_HINT,
  UPSET_VARIANCE_MAX,
} from '../lib/upsetVariance.js';

interface Props {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  id?: string;
}

export function UpsetFactorControl({
  value,
  disabled = false,
  onChange,
  id = 'upset-factor',
}: Props) {
  return (
    <div className="upset-factor">
      <label className="modal-label" htmlFor={id}>
        Upset factor <span className="muted upset-factor-value">{value.toFixed(2)}</span>
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
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <p className="muted upset-factor-hint">{UPSET_FACTOR_HINT}</p>
    </div>
  );
}

export { DEFAULT_UPSET_VARIANCE };
