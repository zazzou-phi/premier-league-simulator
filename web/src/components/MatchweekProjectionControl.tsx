import type { RefObject } from 'react';

interface Props {
  /** Held by the view, which publishes this control's height for the sticky toolbar below it. */
  elementRef?: RefObject<HTMLDivElement>;
  /** Matchweek being read. */
  value: number;
  /** The earliest matchweek carrying a projection, normally 1. */
  min: number;
  /** The latest matchweek worth reading — the round being played next. */
  max: number;
  /** The simulation this matchweek is read through. */
  name: string | null;
  runs: number;
  /** False when the batch was handed this round's results rather than forecasting them. */
  forecast: boolean;
  /** The round being played next, marked so the reader can find their way back to it. */
  now: number | null;
  onChange: (matchweek: number) => void;
}

/**
 * Which matchweek's simulation the projections are read through.
 *
 * Every round carries its own batch — the last one that faced it blind — so stepping back a
 * week is stepping back to the forecast that was actually current then, not a re-run of today's
 * model against an older table. Rounds past the next one are left out: they all read the newest
 * batch, so they would repeat this week's numbers under a different heading.
 */
export function MatchweekProjectionControl({
  elementRef,
  value,
  min,
  max,
  name,
  runs,
  forecast,
  now,
  onChange,
}: Props) {
  const clamp = (matchweek: number) => Math.min(max, Math.max(min, matchweek));
  const atNow = now != null && value === now;

  return (
    <div className="matchweek-control" role="group" aria-label="Matchweek read" ref={elementRef}>
      <div className="matchweek-control-lead">
        <span className="matchweek-control-label">Matchweek</span>
        <strong className="matchweek-control-value">
          MW {value}
          {atNow && <span className="matchweek-control-anchor">now</span>}
        </strong>
        <span className="matchweek-control-source">
          {name == null ? (
            'no simulation'
          ) : (
            <>
              <span className="matchweek-control-name">{name}</span>
              <span className="muted"> · {runs.toLocaleString()} runs</span>
              {!forecast && (
                <span
                  className="matchweek-control-replay"
                  title="This batch was handed the round's results rather than forecasting them"
                >
                  replayed
                </span>
              )}
            </>
          )}
        </span>
      </div>

      <div className="matchweek-control-stepper">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={value <= min}
          aria-label="Previous matchweek"
          onClick={() => onChange(clamp(value - 1))}
        >
          ‹
        </button>
        <input
          type="range"
          className="matchweek-control-range"
          min={min}
          max={Math.max(min, max)}
          step={1}
          value={value}
          disabled={max <= min}
          aria-label={`Read the projection for matchweek ${value} of ${max}`}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={value >= max}
          aria-label="Next matchweek"
          onClick={() => onChange(clamp(value + 1))}
        >
          ›
        </button>
      </div>

      {now != null && (
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={atNow}
          title="Back to the round being played next"
          onClick={() => onChange(now)}
        >
          Now
        </button>
      )}
    </div>
  );
}
