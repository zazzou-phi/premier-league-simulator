import {
  DEFAULT_SEASON_ELO_DELTA_WEIGHT,
  SEASON_ELO_DELTA_WEIGHT_MAX,
  SEASON_FORM_HINT,
  formatSeasonEloDeltaWeight,
} from '../lib/seasonForm.js';

interface Props {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  id?: string;
}

export function SeasonFormControl({
  value,
  disabled = false,
  onChange,
  id = 'season-form',
}: Props) {
  return (
    <div className="upset-factor">
      <label className="modal-label" htmlFor={id}>
        Season form{' '}
        <span className="muted upset-factor-value">{formatSeasonEloDeltaWeight(value)}</span>
      </label>
      <input
        id={id}
        className="modal-range"
        type="range"
        min={0}
        max={SEASON_ELO_DELTA_WEIGHT_MAX}
        step={0.25}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <p className="muted upset-factor-hint">{SEASON_FORM_HINT}</p>
    </div>
  );
}

export { DEFAULT_SEASON_ELO_DELTA_WEIGHT };
