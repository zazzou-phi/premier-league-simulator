import { formatMatchScore } from '../lib/matchFilters.js';

interface ScoreDisplayProps {
  goalsHome: number | null;
  goalsAway: number | null;
  played: boolean;
  /** True when this score is a recorded result rather than a picked scoreline. */
  locked?: boolean;
  actual?: { goalsHome: number; goalsAway: number };
  /** Names the action for assistive tech, e.g. "Outcome distribution: Arsenal vs Coventry". */
  actionLabel?: string;
  onClick?: () => void;
}

/** One side of the pick, shown beside the result it was aiming at. No brackets: in football
 *  they mean a shoot-out. The rules either side of the result do the separating instead. */
function predictedSide(goals: number | null, played: boolean): string {
  return played && goals != null ? String(goals) : '–';
}

/**
 * Scores are read-only everywhere: recorded results come from the fixturedownload sync, and a
 * picked scoreline is derived from a batch. The only action a score carries is opening its
 * outcome distribution, and only where a projection is loaded.
 */
export function ScoreDisplay({
  goalsHome,
  goalsAway,
  played,
  locked = false,
  actual,
  actionLabel,
  onClick,
}: ScoreDisplayProps) {
  const content = actual ? (
    <>
      <span className="score-predicted-home" title="Picked score, home">
        {predictedSide(goalsHome, played)}
      </span>
      <span className="score-actual-center" title="Actual result">
        {actual.goalsHome} - {actual.goalsAway}
      </span>
      <span className="score-predicted-away" title="Picked score, away">
        {predictedSide(goalsAway, played)}
      </span>
    </>
  ) : (
    <>{played ? formatMatchScore(goalsHome, goalsAway, played) : '- vs -'}</>
  );

  const className = [
    'score-display',
    actual ? 'score-with-actual' : played ? (locked ? 'played locked' : 'played') : 'unplayed',
    onClick ? 'score-interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!onClick) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      className={className}
      title={actionLabel}
      aria-label={actionLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {content}
      <span className="score-display-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
