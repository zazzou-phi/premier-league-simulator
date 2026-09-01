import type { ClubSeries } from './ClubLineChart.js';

interface Props {
  series: ClubSeries[];
  /** The club held forward, or null. */
  pinned: number | null;
  /** The club the pointer is over in the plot, marked here so the two stay in step. */
  hovered: number | null;
  onPin: (teamId: number | null) => void;
  onHover: (teamId: number | null) => void;
}

/**
 * The key for a twenty-line chart, and its filter.
 *
 * A legend this long is a control as much as a key: clicking a club pins its line forward and
 * pushes the rest back, which is the only way twenty overlapping series stay readable. Each
 * chip names its club in text, so the swatch is never carrying the identity by itself.
 */
export function ClubChartLegend({ series, pinned, hovered, onPin, onHover }: Props) {
  return (
    <div className="club-chart-legend" role="group" aria-label="Clubs">
      {series.map((line) => {
        const active = pinned === line.teamId;
        return (
          <button
            key={line.teamId}
            type="button"
            className={`club-chart-chip${active ? ' club-chart-chip-active' : ''}${
              hovered === line.teamId ? ' club-chart-chip-hovered' : ''
            }`}
            aria-pressed={active}
            title={active ? `Release ${line.name}` : `Follow ${line.name}`}
            onClick={() => onPin(active ? null : line.teamId)}
            onPointerEnter={() => onHover(line.teamId)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(line.teamId)}
            onBlur={() => onHover(null)}
          >
            <span
              className="club-chart-swatch"
              style={{ background: line.colour }}
              aria-hidden="true"
            />
            {line.code}
          </button>
        );
      })}
      {pinned != null && (
        <button
          type="button"
          className="btn btn-ghost btn-small club-chart-clear"
          onClick={() => onPin(null)}
        >
          Show all
        </button>
      )}
    </div>
  );
}
