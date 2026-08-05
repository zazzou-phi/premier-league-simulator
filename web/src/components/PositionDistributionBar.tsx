import { useState, type PointerEvent } from 'react';
import { TEAM_COUNT, zoneForPosition } from '@shared/engine/standings.js';
import { ordinalPosition, percentilePosition } from '../lib/finishingDistribution.js';

/** Zone boundaries — the same positions the colours already encode. */
const AXIS_LABELS = new Set([1, 4, 5, 17, 20]);

/** Centre of position `p` on a `count`-slot axis, as a left-offset percentage. */
function slotCentre(position: number, count: number): number {
  return ((position - 0.5) / count) * 100;
}

interface AxisProps {
  teamCount?: number;
}

/**
 * The 1–20 ruler the histograms are read against. Rendered once per column (or once above
 * the card list), never per row — a fixed axis is what makes rows comparable, and a shared
 * one is what makes it legible.
 */
export function PositionAxis({ teamCount = TEAM_COUNT }: AxisProps) {
  return (
    <div className="position-axis" aria-hidden="true">
      {Array.from({ length: teamCount }, (_, index) => {
        const position = index + 1;
        return (
          <span key={position} className="position-axis-slot">
            {AXIS_LABELS.has(position) ? position : ''}
          </span>
        );
      })}
    </div>
  );
}

interface Props {
  positionCounts: number[];
  runs: number;
  teamName: string;
}

/**
 * A club's finishing spread as a fixed 20-slot histogram: one slot per position, height
 * proportional to how often it happened, coloured by zone. Unlike the old proportional-width
 * bar, zero-count positions keep their slot, so every row shares the axis above the column
 * and two clubs' spreads line up. P10/P90 ticks mark the middle 80% of outcomes; a readout
 * appears on hover and on touch, where the old `title` tooltip never did.
 */
export function PositionDistributionBar({ positionCounts, runs, teamName }: Props) {
  const [active, setActive] = useState<number | null>(null);

  const total = runs > 0 ? runs : positionCounts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  const teamCount = positionCounts.length;
  const maxCount = Math.max(...positionCounts, 1);
  const p10 = percentilePosition(positionCounts, total, 0.1);
  const p90 = percentilePosition(positionCounts, total, 0.9);

  const summary = `${teamName} finishing position distribution across ${total.toLocaleString()} seasons`;

  const readout =
    active != null
      ? (() => {
          const count = positionCounts[active - 1] ?? 0;
          return `${ordinalPosition(active)}: ${count.toLocaleString()} (${((count / total) * 100).toFixed(1)}%)`;
        })()
      : null;

  // One handler for hover and touch-scrub: map the pointer's x to a position slot.
  const track = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const position = Math.min(teamCount, Math.max(1, Math.floor(ratio * teamCount) + 1));
    setActive(position);
  };

  return (
    <div className="position-hist-wrap">
      {readout && (
        <span className="position-hist-readout" aria-hidden="true">
          {readout}
        </span>
      )}
      <div
        className="position-hist"
        role="img"
        aria-label={summary}
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
      >
        {positionCounts.map((count, index) => {
          const position = index + 1;
          const zone = zoneForPosition(position, teamCount);
          return (
            <span
              key={position}
              className={`position-hist-slot${active === position ? ' active' : ''}`}
            >
              <span
                className={`position-hist-bar position-bar-segment-${zone}`}
                style={{ height: `${(count / maxCount) * 100}%` }}
              />
            </span>
          );
        })}
        {p10 != null && (
          <span
            className="position-hist-pct"
            style={{ left: `${slotCentre(p10, teamCount)}%` }}
          />
        )}
        {p90 != null && p90 !== p10 && (
          <span
            className="position-hist-pct"
            style={{ left: `${slotCentre(p90, teamCount)}%` }}
          />
        )}
      </div>
    </div>
  );
}
