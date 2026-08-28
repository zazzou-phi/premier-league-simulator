import { useMemo, useState, type MouseEvent } from 'react';
import {
  outcomeFromScoreline,
  rankScorelineCandidates,
  type ScorelineCandidate,
} from '@shared/engine/pickStrategy.js';
import type { MatchDistribution, ScorelineCount } from '@shared/simulation/monteCarlo.js';
import type { ResolvedMatch } from '@shared/engine/types.js';
import { Modal } from './Modal.js';

const TOP_SCORELINES = 3;

type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

/** Identifies a breakdown row: a scoreline as `home-away`, or the pooled remainder. */
type ScorelineKey = string;

const OTHER_KEY: ScorelineKey = 'other';

function scorelineKey(scoreline: Pick<ScorelineCount, 'goalsHome' | 'goalsAway'>): ScorelineKey {
  return `${scoreline.goalsHome}-${scoreline.goalsAway}`;
}

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
  /** This outcome's modal scoreline, or null when no run produced the outcome. */
  candidate: ScorelineCandidate | null;
  /** True when `candidate` is the likeliest scoreline across all three outcomes. */
  best: boolean;
  /** Whether this outcome's breakdown is the one showing; one opens at a time. */
  open: boolean;
  /** Opens this outcome's breakdown, or closes it when `scoreline` is null. */
  onToggle: (scoreline: ScorelineKey | null) => void;
  /** Which row of the open breakdown is called out, from the segment that was tapped. */
  selected: ScorelineKey | null;
}

function OutcomeBar({
  label,
  outcome,
  outcomeTotal,
  allTotal,
  scorelines,
  baseColor,
  actualScoreline,
  candidate,
  best,
  open,
  onToggle,
  selected,
}: OutcomeBarProps) {
  const matching = scorelines
    .filter((scoreline) => outcomeFromScoreline(scoreline) === outcome)
    .sort(sortScorelines);
  const top = matching.slice(0, TOP_SCORELINES);
  const otherCount = matching.slice(TOP_SCORELINES).reduce((sum, s) => sum + s.n, 0);
  const segmentCount = top.length + (otherCount > 0 ? 1 : 0);

  if (outcomeTotal === 0 || segmentCount === 0) return null;

  // The track is the button, not the segments inside it. At 375px an outcome worth 4% is a
  // 30px bar holding four segments — targets too small to hit — so the whole bar takes the
  // tap and the x-position picks out which segment was under the finger.
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (open) {
      onToggle(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - rect.left;
    let travelled = 0;
    for (const scoreline of top) {
      travelled += (scoreline.n / outcomeTotal) * rect.width;
      if (offset <= travelled) {
        onToggle(scorelineKey(scoreline));
        return;
      }
    }
    onToggle(otherCount > 0 ? OTHER_KEY : (top[0] ? scorelineKey(top[0]) : null));
  };

  const rows: Array<{ key: ScorelineKey; label: string; n: number; actual: boolean }> = [
    ...top.map((scoreline) => ({
      key: scorelineKey(scoreline),
      label: `${scoreline.goalsHome}–${scoreline.goalsAway}`,
      n: scoreline.n,
      actual: actualScoreline != null && sameScoreline(scoreline, actualScoreline),
    })),
    ...(otherCount > 0
      ? [
          {
            key: OTHER_KEY,
            label: `Other (${matching.length - top.length})`,
            n: otherCount,
            actual: false,
          },
        ]
      : []),
  ];

  return (
    <div className="outcome-bar">
      <div className="outcome-bar-header">
        <span className="outcome-bar-label">{label}</span>
        {candidate && (
          <span
            className={`outcome-bar-ev${best ? ' outcome-bar-ev-best' : ''}`}
            title={`Likeliest scoreline for ${label}: ${candidate.goalsHome}–${candidate.goalsAway}, in ${candidate.n.toLocaleString()} of ${allTotal.toLocaleString()} runs`}
          >
            {candidate.goalsHome}–{candidate.goalsAway}
          </span>
        )}
        <span className="outcome-bar-summary">
          {outcomeTotal.toLocaleString()} ({formatPct(outcomeTotal, allTotal)})
        </span>
      </div>
      <button
        type="button"
        className="outcome-bar-track"
        style={{ width: `${(outcomeTotal / allTotal) * 100}%` }}
        aria-expanded={open}
        aria-label={`${label}: ${formatPct(outcomeTotal, allTotal)} of runs. ${
          open ? 'Hide' : 'Show'
        } the scoreline breakdown.`}
        onClick={handleClick}
      >
        {top.map((scoreline, index) => {
          const key = scorelineKey(scoreline);
          const highlighted =
            actualScoreline != null && sameScoreline(scoreline, actualScoreline);
          return (
            <span
              key={key}
              className={`outcome-bar-segment${highlighted ? ' outcome-bar-segment-actual' : ''}${
                open && selected === key ? ' outcome-bar-segment-selected' : ''
              }`}
              style={{
                flexGrow: scoreline.n,
                backgroundColor: segmentColor(baseColor, index, segmentCount),
              }}
            />
          );
        })}
        {otherCount > 0 && (
          <span
            className={`outcome-bar-segment${
              open && selected === OTHER_KEY ? ' outcome-bar-segment-selected' : ''
            }`}
            style={{ flexGrow: otherCount, backgroundColor: 'var(--border)' }}
          />
        )}
      </button>
      {open && (
        <table className="outcome-bar-breakdown">
          <thead>
            <tr>
              <th scope="col">Score</th>
              <th scope="col">Runs</th>
              <th scope="col" title={`Share of the seasons ending in ${label}`}>
                Of outcome
              </th>
              <th scope="col" title="Share of every simulated season">
                Overall
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={`${row.key === selected ? 'selected' : ''}${
                  row.actual ? ' actual' : ''
                }`}
              >
                <th scope="row">
                  {row.label}
                  {row.actual && <span className="outcome-bar-breakdown-flag"> played</span>}
                </th>
                <td>{row.n.toLocaleString()}</td>
                <td>{formatPct(row.n, outcomeTotal)}</td>
                <td>{formatPct(row.n, allTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

  // One breakdown at a time: three open at once outgrows a phone screen, and the comparison
  // that matters — this outcome's scorelines against each other — is within one bar anyway.
  const [openBar, setOpenBar] = useState<{
    outcome: MatchOutcome;
    scoreline: ScorelineKey | null;
  } | null>(null);

  const toggleBar = (outcome: MatchOutcome) => (scoreline: ScorelineKey | null) => {
    setOpenBar(scoreline == null ? null : { outcome, scoreline });
  };

  const candidates = useMemo(
    () => (distribution && total > 0 ? rankScorelineCandidates(scorelines) : []),
    [distribution, scorelines, total],
  );
  const bestCandidate = candidates[0] ?? null;
  const candidateFor = (outcome: MatchOutcome): ScorelineCandidate | null =>
    candidates.find((c) => c.outcome === outcome) ?? null;

  const played = match.result.status === 'played';
  const actualScoreline =
    played && match.result.goalsHome != null && match.result.goalsAway != null
      ? { goalsHome: match.result.goalsHome, goalsAway: match.result.goalsAway }
      : null;

  // On a played fixture `result` is the real score, so the pick is a separate figure — and the
  // one this modal exists to explain. It is absent on a fixture the batch was handed.
  const pick = match.locked ? (match.pick ?? null) : actualScoreline;

  return (
    <Modal className="modal modal-wide" titleId="match-distribution-title" onClose={onClose}>
      <h2 id="match-distribution-title">
        Match #{match.fixture.matchNumber} · Matchday {match.fixture.matchday}
      </h2>
      <p className="match-distribution-teams">
        {match.teamHome.name} vs {match.teamAway.name}
      </p>
      {bestCandidate && (
        <p className="muted match-distribution-meta">
          Likeliest scoreline:{' '}
          <strong>
            {bestCandidate.goalsHome}–{bestCandidate.goalsAway}
          </strong>{' '}
          · {formatPct(bestCandidate.n, total)} of {total.toLocaleString()} runs
        </p>
      )}
      {pick || actualScoreline ? (
        <p className="match-distribution-pick">
          {pick && (
            <span className="match-distribution-picked">
              Pick: {pick.goalsHome}–{pick.goalsAway}
            </span>
          )}
          {pick && match.locked && actualScoreline && ' · '}
          {match.locked && actualScoreline && (
            <span className="match-distribution-actual">
              Recorded result: {actualScoreline.goalsHome}–{actualScoreline.goalsAway}
            </span>
          )}
          {match.locked && !pick && (
            <span className="muted"> — this batch was handed the result, it did not predict it</span>
          )}
        </p>
      ) : (
        <p className="muted match-distribution-pick">No scoreline yet</p>
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
            candidate={candidateFor('homeWin')}
            best={bestCandidate?.outcome === 'homeWin'}
            open={openBar?.outcome === 'homeWin'}
            selected={openBar?.outcome === 'homeWin' ? openBar.scoreline : null}
            onToggle={toggleBar('homeWin')}
          />
          <OutcomeBar
            label="Draw"
            outcome="draw"
            outcomeTotal={distribution.outcomes.draw}
            allTotal={total}
            scorelines={scorelines}
            baseColor="var(--yellow)"
            actualScoreline={actualScoreline}
            candidate={candidateFor('draw')}
            best={bestCandidate?.outcome === 'draw'}
            open={openBar?.outcome === 'draw'}
            selected={openBar?.outcome === 'draw' ? openBar.scoreline : null}
            onToggle={toggleBar('draw')}
          />
          <OutcomeBar
            label={`${match.teamAway.name} win`}
            outcome="awayWin"
            outcomeTotal={distribution.outcomes.awayWin}
            allTotal={total}
            scorelines={scorelines}
            baseColor="var(--accent)"
            actualScoreline={actualScoreline}
            candidate={candidateFor('awayWin')}
            best={bestCandidate?.outcome === 'awayWin'}
            open={openBar?.outcome === 'awayWin'}
            selected={openBar?.outcome === 'awayWin' ? openBar.scoreline : null}
            onToggle={toggleBar('awayWin')}
          />
          <p className="muted outcome-bar-total">
            Top {TOP_SCORELINES} scorelines plus the remainder per outcome ·{' '}
            {total.toLocaleString()} simulated season{total === 1 ? '' : 's'} · tap a bar for its
            scoreline percentages
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
