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
  variant?: 'compact' | 'full';
  id?: string;
}

export function SeasonFormControl({
  value,
  disabled = false,
  onChange,
  variant = 'compact',
  id = 'season-form',
}: Props) {
  const displayValue = formatSeasonEloDeltaWeight(value);

  if (variant === 'compact') {
    return (
      <div className="upset-factor upset-factor-compact" title={SEASON_FORM_HINT}>
        <label className="upset-factor-label" htmlFor={id} title={SEASON_FORM_HINT}>
          Season form <span className="upset-factor-value">{displayValue}</span>
        </label>
        <input
          id={id}
          className="upset-factor-range"
          type="range"
          min={0}
          max={SEASON_ELO_DELTA_WEIGHT_MAX}
          step={0.25}
          value={value}
          disabled={disabled}
          title={SEASON_FORM_HINT}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="upset-factor upset-factor-full">
      <label className="modal-label" htmlFor={id} title={SEASON_FORM_HINT}>
        Season form <span className="muted upset-factor-value">{displayValue}</span>
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
        title={SEASON_FORM_HINT}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <p className="muted upset-factor-hint">{SEASON_FORM_HINT}</p>
    </div>
  );
}

export { DEFAULT_SEASON_ELO_DELTA_WEIGHT };
