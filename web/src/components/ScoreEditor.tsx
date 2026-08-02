import { useEffect, useState } from 'react';
import type { ResolvedMatch } from '@shared/engine/types.js';
import { formatMatchScore } from '../lib/matchFilters.js';

interface ScoreEditorProps {
  match: ResolvedMatch;
  onSave: (goalsHome: number, goalsAway: number) => void;
  onCancel: () => void;
}

export function ScoreEditor({ match, onSave, onCancel }: ScoreEditorProps) {
  const [home, setHome] = useState(String(match.result.goalsHome ?? 0));
  const [away, setAway] = useState(String(match.result.goalsAway ?? 0));

  useEffect(() => {
    setHome(String(match.result.goalsHome ?? 0));
    setAway(String(match.result.goalsAway ?? 0));
  }, [match.fixture.matchNumber]);

  const trySave = () => {
    onSave(parseInt(home, 10) || 0, parseInt(away, 10) || 0);
  };

  return (
    <div className="score-editor" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min={0}
        max={99}
        value={home}
        onChange={(e) => setHome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') trySave();
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
      />
      <span className="score-sep">-</span>
      <input
        type="number"
        min={0}
        max={99}
        value={away}
        onChange={(e) => setAway(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') trySave();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button type="button" className="btn btn-small" onClick={trySave}>
        Save
      </button>
      <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

interface ScoreDisplayProps {
  goalsHome: number | null;
  goalsAway: number | null;
  played: boolean;
  actual?: { goalsHome: number; goalsAway: number };
  onClick?: () => void;
  onDoubleClick?: () => void;
}

function predictedSide(goals: number | null, played: boolean): string {
  return `(${played && goals != null ? String(goals) : '–'})`;
}

export function ScoreDisplay({
  goalsHome,
  goalsAway,
  played,
  actual,
  onClick,
  onDoubleClick,
}: ScoreDisplayProps) {
  if (actual) {
    const interactive = played && onClick != null;
    const className = `score-display score-with-actual${interactive ? ' score-interactive' : ''}`;

    const content = (
      <>
        <span className="score-predicted-home">{predictedSide(goalsHome, played)}</span>
        <span className="score-actual-center" title="Actual result">
          {actual.goalsHome} - {actual.goalsAway}
        </span>
        <span className="score-predicted-away">{predictedSide(goalsAway, played)}</span>
      </>
    );

    if (!interactive) {
      return <div className={className}>{content}</div>;
    }

    return (
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
      >
        {content}
      </button>
    );
  }

  if (!played) {
    return (
      <button
        type="button"
        className="score-display unplayed"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
      >
        - vs -
      </button>
    );
  }

  return (
    <button
      type="button"
      className="score-display played"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
    >
      {formatMatchScore(goalsHome, goalsAway, played)}
    </button>
  );
}
