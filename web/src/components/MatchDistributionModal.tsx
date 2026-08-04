import { useMemo } from 'react';
import { computeMeanExpectedGoals, outcomeFromScoreline } from '@shared/engine/consensus.js';
import type { MatchDistribution, ScorelineCount } from '@shared/simulation/monteCarlo.js';
import type { ResolvedMatch } from '@shared/engine/types.js';
import { Modal } from './Modal.js';

const TOP_SCORELINES = 3;

type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

interface Props {
  match: ResolvedMatch;
  distribution: MatchDistribution | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}

function formatPct(count: number, total: number): string {
  if (total === 0) return '0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function segmentColor(baseVar: string, index: number, segmentCount: number): string {
  if (segmentCount <= 1) return baseVar;
  const darken = 8 + (index * 36) / (segmentCount - 1);
  return `color-mix(in srgb, ${baseVar} ${100 - darken}%, black)`;
}

function sortScorelines(a: ScorelineCount, b: ScorelineCount): number {
  if (b.n !== a.n) return b.n - a.n;
  const totalA = a.goalsHome + a.goalsAway;
  const totalB = b.goalsHome + b.goalsAway;
  if (totalB !== totalA) return totalB - totalA;
  return b.goalsHome - a.goalsHome || b.goalsAway - a.goalsAway;
}

function sameScoreline(
  a: Pick<ScorelineCount, 'goalsHome' | 'goalsAway'>,
  b: Pick<ScorelineCount, 'goalsHome' | 'goalsAway'>,
): boolean {
  return a.goalsHome === b.goalsHome && a.goalsAway === b.goalsAway;
}

interface OutcomeBarProps {
  label: string;
  outcome: MatchOutcome;
  outcomeTotal: number;
  allTotal: number;
  scorelines: ScorelineCount[];
  baseColor: string;
  actualScoreline: Pick<ScorelineCount, 'goalsHome' | 'goalsAway'> | null;
}

function OutcomeBar({
  label,
  outcome,
  outcomeTotal,
  allTotal,
  scorelines,
  baseColor,
  actualScoreline,
}: OutcomeBarProps) {
  const matching = scorelines
    .filter((scoreline) => outcomeFromScoreline(scoreline) === outcome)
    .sort(sortScorelines);
  const top = matching.slice(0, TOP_SCORELINES);
  const otherCount = matching.slice(TOP_SCORELINES).reduce((sum, s) => sum + s.n, 0);
  const segmentCount = top.length + (otherCount > 0 ? 1 : 0);

  if (outcomeTotal === 0 || segmentCount === 0) return null;

  return (
    <div className="outcome-bar">
      <div className="outcome-bar-header">
        <span className="outcome-bar-label">{label}</span>
        <span className="outcome-bar-summary">
          {outcomeTotal.toLocaleString()} ({formatPct(outcomeTotal, allTotal)})
        </span>
      </div>
      <div className="outcome-bar-track" style={{ width: `${(outcomeTotal / allTotal) * 100}%` }}>
        {top.map((scoreline, index) => {
          const highlighted =
            actualScoreline != null && sameScoreline(scoreline, actualScoreline);
          return (
            <div
              key={`${scoreline.goalsHome}-${scoreline.goalsAway}`}
              className={`outcome-bar-segment${highlighted ? ' outcome-bar-segment-actual' : ''}`}
              style={{
                flexGrow: scoreline.n,
                backgroundColor: segmentColor(baseColor, index, segmentCount),
              }}
              title={`${scoreline.goalsHome}–${scoreline.goalsAway}: ${scoreline.n.toLocaleString()} · ${formatPct(scoreline.n, outcomeTotal)} of outcome · ${formatPct(scoreline.n, allTotal)} overall`}
            />
          );
        })}
        {otherCount > 0 && (
          <div
            className="outcome-bar-segment"
            style={{ flexGrow: otherCount, backgroundColor: 'var(--border)' }}
            title={`Other scorelines: ${otherCount.toLocaleString()} · ${formatPct(otherCount, outcomeTotal)} of outcome`}
          />
        )}
      </div>
    </div>
  );
}

export function MatchDistributionModal({
  match,
  distribution,
  loading = false,
  error = null,
  onClose,
}: Props) {
  const scorelines = distribution?.scorelines ?? [];
  const total = distribution?.outcomes.total ?? 0;
  const expectedGoals = useMemo(
    () => (total > 0 ? computeMeanExpectedGoals(scorelines) : null),
    [scorelines, total],
  );

  const played = match.result.status === 'played';
  const actualScoreline =
    played && match.result.goalsHome != null && match.result.goalsAway != null
      ? { goalsHome: match.result.goalsHome, goalsAway: match.result.goalsAway }
      : null;

  return (
    <Modal className="modal modal-wide" titleId="match-distribution-title" onClose={onClose}>
      <h2 id="match-distribution-title">
        Match #{match.fixture.matchNumber} · Matchday {match.fixture.matchday}
      </h2>
      <p className="match-distribution-teams">
        {match.teamHome.name} vs {match.teamAway.name}
      </p>
      {expectedGoals && (
        <p className="muted match-distribution-meta">
          Expected goals: {expectedGoals.goalsHome.toFixed(2)}–
          {expectedGoals.goalsAway.toFixed(2)}
        </p>
      )}
      {actualScoreline ? (
        <p className="match-distribution-consensus">
          {match.locked ? 'Recorded result' : 'Consensus'}: {actualScoreline.goalsHome}–
          {actualScoreline.goalsAway}
        </p>
      ) : (
        <p className="muted match-distribution-consensus">No scoreline yet</p>
      )}

      {loading ? (
        <p className="muted">Loading distribution…</p>
      ) : error ? (
        <p className="modal-warning">{error}</p>
      ) : distribution && total > 0 ? (
        <div className="outcome-bar-chart">
          <OutcomeBar
            label={`${match.teamHome.name} win`}
            outcome="homeWin"
            outcomeTotal={distribution.outcomes.homeWin}
            allTotal={total}
            scorelines={scorelines}
            baseColor="var(--green)"
            actualScoreline={actualScoreline}
          />
          <OutcomeBar
            label="Draw"
            outcome="draw"
            outcomeTotal={distribution.outcomes.draw}
            allTotal={total}
            scorelines={scorelines}
            baseColor="var(--yellow)"
            actualScoreline={actualScoreline}
          />
          <OutcomeBar
            label={`${match.teamAway.name} win`}
            outcome="awayWin"
            outcomeTotal={distribution.outcomes.awayWin}
            allTotal={total}
            scorelines={scorelines}
            baseColor="var(--accent)"
            actualScoreline={actualScoreline}
          />
          <p className="muted outcome-bar-total">
            Top {TOP_SCORELINES} scorelines plus the remainder per outcome ·{' '}
            {total.toLocaleString()} simulated season{total === 1 ? '' : 's'} · hover a section
            for details
          </p>
        </div>
      ) : (
        <p className="muted">No simulation data for this fixture yet.</p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
