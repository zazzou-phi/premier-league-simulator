interface Props {
  /** Matchday the season is shown through. */
  value: number;
  max: number;
  /** Highest matchday holding a real result, or 0 before a ball is kicked. */
  playedThrough: number;
  /** Where "now" sits: the rounds played, plus the round being played next. */
  now: number;
  /** Fixtures inside the cut carrying a recorded result. */
  actualCount: number;
  /** Fixtures inside the cut carrying a picked scoreline instead. */
  predictedCount: number;
  onChange: (matchday: number) => void;
}

/**
 * How far into the season to read. Everything up to this round counts towards the table —
 * real scores where they exist, picks where they do not — and everything after it is blank.
 */
export function MatchdayCutoffControl({
  value,
  max,
  playedThrough,
  now,
  actualCount,
  predictedCount,
  onChange,
}: Props) {
  const clamp = (matchday: number) => Math.min(max, Math.max(1, matchday));

  // Now runs through the round being played next, so the cutoff lands on the same matchday the
  // header calls next and the title spells out how the two halves of that round are counted.
  const atNow = playedThrough > 0 && value === now;
  const anchor = atNow ? 'now' : value === max ? 'full season' : null;
  const explanation = atNow
    ? now > playedThrough
      ? `Matchday ${playedThrough} is the last round played; matchday ${now} is next, counted from its picks`
      : `Matchday ${value} is the last round played, and nothing is left to come before it`
    : `The table counts every fixture up to matchday ${value}, played or picked`;

  return (
    <div className="matchday-cutoff" role="group" aria-label="Season shown through matchday">
      <div className="matchday-cutoff-lead" title={explanation}>
        <span className="matchday-cutoff-label">Season through</span>
        <strong className="matchday-cutoff-value">
          MD {value}
          {anchor && <span className="matchday-cutoff-anchor">{anchor}</span>}
        </strong>
        <span className="matchday-cutoff-counts">
          <span className="matchday-cutoff-count-actual">{actualCount} actual</span>
          {' · '}
          <span className="matchday-cutoff-count-predicted">{predictedCount} predicted</span>
        </span>
      </div>

      <div className="matchday-cutoff-slider">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={value <= 1}
          aria-label="One matchday earlier"
          onClick={() => onChange(clamp(value - 1))}
        >
          ‹
        </button>
        <input
          type="range"
          className="matchday-cutoff-range"
          min={1}
          max={max}
          step={1}
          value={value}
          list="matchday-cutoff-ticks"
          aria-label={`Show the season through matchday ${value} of ${max}`}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        {/* Marks where the real season has got to, so the handle has something to aim at. */}
        <datalist id="matchday-cutoff-ticks">
          {playedThrough > 0 && <option value={now} label="Now" />}
          <option value={max} />
        </datalist>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={value >= max}
          aria-label="One matchday later"
          onClick={() => onChange(clamp(value + 1))}
        >
          ›
        </button>
      </div>

      <div className="matchday-cutoff-quick">
        {playedThrough > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={value === now}
            title="Show the rounds played, plus the round coming up"
            onClick={() => onChange(now)}
          >
            Now
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={value === max}
          title="Show the whole season, predictions included"
          onClick={() => onChange(max)}
        >
          Full season
        </button>
      </div>
    </div>
  );
}
