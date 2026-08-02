import { zoneForPosition } from '@shared/engine/standings.js';

interface Props {
  positionCounts: number[];
  runs: number;
  teamName: string;
}

/**
 * One flex segment per finishing position, sized by how often it happened and coloured by
 * the zone that position lands in. Segments for positions that never occurred are dropped
 * so a club with a narrow range reads as a narrow band.
 */
export function PositionDistributionBar({ positionCounts, runs, teamName }: Props) {
  const total = runs > 0 ? runs : positionCounts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  const teamCount = positionCounts.length;

  return (
    <div
      className="position-bar"
      role="img"
      aria-label={`${teamName} finishing position distribution across ${total.toLocaleString()} seasons`}
    >
      {positionCounts.map((count, index) => {
        if (count === 0) return null;
        const position = index + 1;
        const zone = zoneForPosition(position, teamCount);
        const share = (count / total) * 100;
        return (
          <div
            key={position}
            className={`position-bar-segment position-bar-segment-${zone}`}
            style={{ flexGrow: count }}
            title={`${position}${position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'}: ${count.toLocaleString()} (${share.toFixed(1)}%)`}
          />
        );
      })}
    </div>
  );
}
