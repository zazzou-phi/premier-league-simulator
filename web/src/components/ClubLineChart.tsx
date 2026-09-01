import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useElementSize } from '../lib/useElementSize.js';

export interface ClubSeries {
  teamId: number;
  /** Three-letter code, used as the line's direct label. */
  code: string;
  name: string;
  colour: string;
  dash?: string;
  /** One entry per x tick, null where that club has no reading. */
  values: Array<number | null>;
}

/** Which club the pointer is nearest, and at which x tick. */
export interface ChartHover {
  index: number;
  teamId: number;
}

interface Props {
  series: ClubSeries[];
  /** Axis labels, one per x position; also what the tooltip names a column by. */
  xLabels: string[];
  xTitle: string;
  yTitle: string;
  /** True for rankings, where 1 belongs at the top. */
  invertY?: boolean;
  /** Fixed y range. Omitted, the chart fits the data with a little headroom. */
  yDomain?: [number, number];
  formatValue: (value: number) => string;
  /**
   * The club to bring forward while the rest recede. Owned by the caller, which is the only
   * place that knows whether it came from a pin or from a pointer over the legend.
   */
  active: number | null;
  /** Reported so the legend can mark whichever club the pointer is over. */
  onHover?: (hover: ChartHover | null) => void;
  /** The club under the pointer when the plot was clicked; the caller decides what a pin means. */
  onPin?: (teamId: number | null) => void;
  height?: number;
  /** Shown in place of the plot when there is nothing to draw. */
  emptyMessage?: ReactNode;
}

const PADDING = { top: 14, right: 52, bottom: 34, left: 50 };
const MIN_WIDTH = 280;
/** Past this many readings a dot per point is a bead curtain; the line carries it alone. */
const MAX_DOTTED_POINTS = 14;
/** Rough width of an axis label, used to decide how many of them fit without colliding. */
const X_LABEL_WIDTH = 54;
/** Line height of an end label, the floor the de-collision pass separates them by. */
const END_LABEL_GAP = 11;

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}

/**
 * Push a column of labels apart until none overlaps, keeping their original order.
 *
 * Twenty clubs converge on a narrow band of the axis — the whole point of the chart is that
 * they are close — so left where the data puts them the end labels would stack into a smear.
 * One forward pass claims the minimum gap, one backward pass pulls the overflow back inside.
 */
function separate(positions: number[], gap: number, min: number, max: number): number[] {
  const order = positions.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  let previous = min - gap;
  for (const entry of order) {
    entry.y = Math.max(entry.y, previous + gap);
    previous = entry.y;
  }
  let ceiling = max;
  for (let i = order.length - 1; i >= 0; i--) {
    order[i]!.y = Math.min(order[i]!.y, ceiling);
    ceiling = order[i]!.y - gap;
  }
  const resolved = new Array<number>(positions.length);
  for (const entry of order) resolved[entry.index] = entry.y;
  return resolved;
}

/**
 * Twenty clubs across a season, one line each.
 *
 * Twenty is far more series than colour alone can carry, so identity is spread over three
 * channels that do not depend on it: every line ends in its club's code, a dash pattern rides
 * alongside the hue, and the club nearest the pointer — or the one pinned from the legend —
 * comes forward while the other nineteen recede. The table on the same screen is the table
 * view of the same numbers.
 */
export function ClubLineChart({
  series,
  xLabels,
  xTitle,
  yTitle,
  invertY = false,
  yDomain,
  formatValue,
  active,
  onHover,
  onPin,
  height = 340,
  emptyMessage,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measured = useElementSize(wrapRef);
  const [hover, setHover] = useState<ChartHover | null>(null);

  const width = Math.max(MIN_WIDTH, measured?.width ?? MIN_WIDTH);
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const domain = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    const values = series.flatMap((line) => line.values.filter((v): v is number => v != null));
    if (values.length === 0) return [0, 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat series would collapse the axis; give it a band to sit in the middle of.
    if (min === max) return [min - 1, max + 1];
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }, [series, yDomain]);

  const xAt = (index: number) =>
    PADDING.left +
    (xLabels.length === 1 ? plotWidth / 2 : (index / (xLabels.length - 1)) * plotWidth);

  const yAt = (value: number) => {
    const share = (value - domain[0]) / (domain[1] - domain[0]);
    return PADDING.top + (invertY ? share : 1 - share) * plotHeight;
  };

  const ticks = useMemo(() => niceTicks(domain[0], domain[1]), [domain]);

  /** Every club's drawable points, plus where its end label ends up once nothing overlaps. */
  const lines = useMemo(() => {
    const drawn = series.map((line) => ({
      line,
      points: line.values
        .map((value, index) => (value == null ? null : ([xAt(index), yAt(value)] as const)))
        .filter((point): point is readonly [number, number] => point != null),
    }));
    const labelled = drawn.filter((entry) => entry.points.length > 0);
    const labelY = separate(
      labelled.map((entry) => entry.points.at(-1)![1]),
      END_LABEL_GAP,
      PADDING.top + 4,
      PADDING.top + plotHeight,
    );
    return labelled.map((entry, index) => ({ ...entry, labelY: labelY[index]! }));
    // xAt and yAt are closures over exactly these, so listing them again would be noise.
  }, [series, width, height, plotHeight, domain, invertY, xLabels.length]);

  // Only as many axis labels as fit side by side; the last one always survives, since it names
  // where the season has got to.
  const labelStride = Math.max(
    1,
    Math.ceil(xLabels.length / Math.max(1, Math.floor(plotWidth / X_LABEL_WIDTH))),
  );

  const activeSeries = active == null ? null : series.find((line) => line.teamId === active);
  const readingIndex = hover?.index ?? xLabels.length - 1;
  const empty = xLabels.length === 0 || series.length === 0;

  const report = (next: ChartHover | null) => {
    setHover(next);
    onHover?.(next);
  };

  /** Nearest point wins — a 2px line is far too thin a target to ask a pointer to find. */
  const handleMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    const index =
      xLabels.length === 1
        ? 0
        : Math.min(
            xLabels.length - 1,
            Math.max(0, Math.round(((px - PADDING.left) / plotWidth) * (xLabels.length - 1))),
          );

    let nearest: ChartHover | null = null;
    let bestDistance = Infinity;
    for (const line of series) {
      const value = line.values[index];
      if (value == null) continue;
      const distance = Math.abs(yAt(value) - py);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = { index, teamId: line.teamId };
      }
    }
    report(nearest);
  };

  // One wrapper, always mounted: it is what the width is measured from, and returning early
  // for the empty case left the observer with nothing to watch — a chart whose data arrived
  // after its first render then stayed pinned at MIN_WIDTH for good.
  return (
    <div className="club-chart" ref={wrapRef}>
      {empty && <p className="panel-empty">{emptyMessage ?? 'Nothing to plot yet.'}</p>}
      {!empty && (
        <>
          <svg
            className="club-chart-plot"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${yTitle} by ${xTitle.toLowerCase()}, one line per club`}
            onPointerMove={handleMove}
            onPointerLeave={() => report(null)}
            onClick={() => onPin?.(hover?.teamId ?? null)}
          >
            {/* Gridlines and axes recede: they are scaffolding for the marks, not marks. */}
            {ticks.map((tick) => {
              const y = yAt(tick);
              return (
                <g key={tick}>
                  <line
                    x1={PADDING.left}
                    x2={PADDING.left + plotWidth}
                    y1={y}
                    y2={y}
                    className="club-chart-grid"
                  />
                  <text x={PADDING.left - 8} y={y + 4} className="club-chart-tick club-chart-tick-y">
                    {formatValue(tick)}
                  </text>
                </g>
              );
            })}

            {xLabels.map((label, index) =>
              index % labelStride === 0 || index === xLabels.length - 1 ? (
                <text
                  key={label}
                  x={xAt(index)}
                  y={height - 12}
                  className="club-chart-tick club-chart-tick-x"
                >
                  {label}
                </text>
              ) : null,
            )}

            {hover && (
              <line
                x1={xAt(hover.index)}
                x2={xAt(hover.index)}
                y1={PADDING.top}
                y2={PADDING.top + plotHeight}
                className="club-chart-crosshair"
              />
            )}

            {lines.map(({ line, points, labelY }) => {
              const lead = active === line.teamId;
              const dimmed = active != null && !lead;
              const path = points
                .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
                .join(' ');
              const [endX, endY] = points.at(-1)!;
              const dots = points.length <= MAX_DOTTED_POINTS ? points : [points.at(-1)!];

              return (
                <g
                  key={line.teamId}
                  className={`club-chart-series${dimmed ? ' club-chart-series-dim' : ''}${
                    lead ? ' club-chart-series-lead' : ''
                  }`}
                >
                  <path d={path} stroke={line.colour} strokeDasharray={line.dash} fill="none" />
                  {dots.map(([x, y], index) => (
                    // A surface ring keeps two lines crossing at a point from merging into a blob.
                    <circle key={index} cx={x} cy={y} r={lead ? 5 : 4} fill={line.colour} className="club-chart-dot" />
                  ))}
                  {/* A leader where de-collision has moved the label off its own line's end. */}
                  {Math.abs(labelY - endY) > 1.5 && (
                    <line
                      x1={endX + 2}
                      y1={endY}
                      x2={endX + 7}
                      y2={labelY - 4}
                      stroke={line.colour}
                      className="club-chart-leader"
                    />
                  )}
                  {/* Direct labels, so no club is ever identified by its colour alone. */}
                  <text x={endX + 9} y={labelY} className="club-chart-end-label">
                    {line.code}
                  </text>
                </g>
              );
            })}
          </svg>

          {activeSeries && (
            <div
              className="club-chart-tooltip"
              style={{ left: `${Math.min(width - 172, Math.max(0, xAt(readingIndex) - 82))}px` }}
              role="status"
            >
              <span className="club-chart-tooltip-title">{activeSeries.name}</span>
              <span className="club-chart-tooltip-value">
                {xLabels[readingIndex]} ·{' '}
                {activeSeries.values[readingIndex] == null
                  ? 'no reading'
                  : formatValue(activeSeries.values[readingIndex]!)}
              </span>
            </div>
          )}

          <p className="club-chart-axis-title muted">{xTitle}</p>
        </>
      )}
    </div>
  );
}
