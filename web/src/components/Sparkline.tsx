/**
 * Trend marks for stat rows and small panels. Both are single-series, so neither carries
 * a legend — the column header or panel title names what is plotted. Text never wears the
 * data colour; the numeric value lives in its own cell in the app's text tokens.
 */

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Accessible description; the series is also readable as a number beside the mark. */
  label: string;
  /**
   * Direction of the latest step, colouring the end dot only. The line itself stays
   * de-emphasised: it spans the whole series, so colouring it by overall direction would
   * contradict the adjacent change figure whenever the last step went the other way.
   */
  latestDirection?: 'up' | 'down' | 'flat';
}

const STROKE = 2;
const END_RADIUS = 3;

/** A bare trend line with an end dot — no axes, no labels, no gridlines. */
export function Sparkline({
  values,
  width = 72,
  height = 24,
  label,
  latestDirection = 'flat',
}: SparklineProps) {
  if (values.length < 2) return <span className="spark-empty" aria-label={label} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  // A flat series would divide by zero; draw it down the middle instead.
  const inset = STROKE / 2 + END_RADIUS;
  const plotHeight = height - inset * 2;
  const plotWidth = width - inset * 2;

  const points = values.map((value, index) => {
    const x = inset + (index / (values.length - 1)) * plotWidth;
    const y =
      span === 0 ? height / 2 : inset + plotHeight - ((value - min) / span) * plotHeight;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = points.at(-1)!;
  const endFill =
    latestDirection === 'up'
      ? 'var(--green)'
      : latestDirection === 'down'
        ? 'var(--red)'
        : 'var(--text-muted)';

  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Surface ring keeps the end dot legible where it sits on the line. */}
      <circle
        cx={lastX}
        cy={lastY}
        r={END_RADIUS}
        fill={endFill}
        stroke="var(--bg-elevated)"
        strokeWidth={2}
      />
    </svg>
  );
}

export interface DivergingPoint {
  key: string | number;
  /** Axis label under the baseline, e.g. a matchday number. */
  label: string;
  value: number;
  tooltip: string;
}

interface DivergingBarsProps {
  points: DivergingPoint[];
  height?: number;
  /** Rendered under the chart to name the measure — a single series needs no legend. */
  caption: string;
}

/**
 * Columns above/below a zero baseline. The job is polarity — did this projection beat a
 * uniform guess or not — so the encoding is diverging: two hues either side of a neutral
 * baseline, never a rainbow or a single ramp.
 *
 * Laid out in CSS rather than a stretched SVG: a `preserveAspectRatio="none"` viewBox
 * scales bar thickness with the container, which makes a thickness cap meaningless and
 * turns three data points into three slabs.
 */
export function DivergingBars({ points, height = 120, caption }: DivergingBarsProps) {
  if (points.length === 0) return null;

  // Scale to the largest absolute value, with a floor so a near-flat season is not
  // magnified into drama.
  const magnitude = Math.max(...points.map((point) => Math.abs(point.value)), 0.1);

  return (
    <figure className="diverging-figure">
      <div className="diverging" style={{ height }} role="img" aria-label={caption}>
        <div className="diverging-baseline" />
        {points.map((point) => {
          const positive = point.value >= 0;
          // Bars grow from the mid-line, so the tallest may use only half the box; 44%
          // rather than 50% keeps the extreme off the container edge.
          const share = `${Math.min(44, (Math.abs(point.value) / magnitude) * 44)}%`;
          return (
            <div className="diverging-slot" key={point.key} title={point.tooltip}>
              <span
                className={`diverging-bar ${positive ? 'diverging-up' : 'diverging-down'}`}
                style={{ height: share }}
              />
            </div>
          );
        })}
      </div>
      {/* Mirrors the chart's flex layout exactly so each tick sits under its own bar. */}
      <div className="diverging-axis">
        {points.map((point) => (
          <span key={point.key} title={point.tooltip}>
            {point.label}
          </span>
        ))}
      </div>
      <figcaption className="muted">{caption}</figcaption>
    </figure>
  );
}
