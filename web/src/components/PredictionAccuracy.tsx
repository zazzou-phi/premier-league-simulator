import type { AccuracyHistoryPoint, PredictionAccuracy } from '../types.js';
import { DivergingBars } from './Sparkline.js';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;

/** Positive skill means the batch beat a uniform 1/3 guess. */
function skillTone(skillScore: number): string {
  if (skillScore >= 0.05) return 'accuracy-good';
  if (skillScore > -0.05) return 'accuracy-even';
  return 'accuracy-bad';
}

/** One line under the list: how the selected projection has held up so far. */
export function PredictionAccuracySummary({
  accuracy,
  loading,
}: {
  accuracy: PredictionAccuracy | null;
  loading: boolean;
}) {
  if (loading) return <p className="muted accuracy-summary">Grading…</p>;
  if (!accuracy) return null;

  if (accuracy.graded === 0) {
    return (
      <p className="muted accuracy-summary">
        Nothing graded yet — none of the {accuracy.pending} fixtures it predicted blind have
        been played.
      </p>
    );
  }

  return (
    <p className="accuracy-summary">
      <span className="muted">Graded {accuracy.graded}</span>
      <span className={skillTone(accuracy.skillScore)}>skill {signed(accuracy.skillScore)}</span>
      <span className="muted">outcome {pct(accuracy.outcomeHitRate)}</span>
      <span className="muted">exact {pct(accuracy.scorelineHitRate)}</span>
    </p>
  );
}

/**
 * Full grading detail. Locked fixtures are excluded upstream: Monte Carlo replays a known
 * result verbatim, so grading one would only measure the lock.
 */
/**
 * Skill score per projection across the season — did each week's batch beat a uniform
 * guess. The job is polarity, so the encoding is diverging around a zero baseline. The
 * table below carries the same numbers, so nothing is gated behind the chart.
 */
export function AccuracyTrend({ history }: { history: AccuracyHistoryPoint[] }) {
  if (history.length < 2) return null;

  return (
    <>
      <p className="modal-hint accuracy-trend-hint">
        Skill by projection — above the line beat a 1/3-each guess, below it did not.
      </p>
      <DivergingBars
        caption="Skill score per projection, in season order"
        points={history.map((point) => ({
          key: point.predictionId,
          label: point.asOfMatchday != null ? String(point.asOfMatchday) : '–',
          value: point.skillScore,
          tooltip:
            `${point.name} — skill ${point.skillScore >= 0 ? '+' : ''}` +
            `${point.skillScore.toFixed(3)}, ${point.graded} graded, ` +
            `outcome ${pct(point.outcomeHitRate)}`,
        }))}
      />
      <div className="accuracy-table-wrap">
        <table className="accuracy-table">
          <thead>
            <tr>
              <th>Projection</th>
              <th>Graded</th>
              <th>Brier</th>
              <th>Skill</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {history.map((point) => (
              <tr key={point.predictionId}>
                <td>{point.name}</td>
                <td>{point.graded}</td>
                <td>{point.brierScore.toFixed(3)}</td>
                <td className={skillTone(point.skillScore)}>{signed(point.skillScore)}</td>
                <td>{pct(point.outcomeHitRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PredictionAccuracyPanel({ accuracy }: { accuracy: PredictionAccuracy }) {
  if (accuracy.graded === 0) {
    return (
      <p className="muted">
        Nothing to grade yet. This projection predicted {accuracy.pending} fixtures blind;
        none has been played. {accuracy.skippedLocked > 0 &&
          `${accuracy.skippedLocked} more were already recorded when it ran, so they are excluded.`}
      </p>
    );
  }

  return (
    <>
      <p className="muted accuracy-scope">
        {accuracy.graded} graded · {accuracy.pending} still to play · {accuracy.skippedLocked}{' '}
        already known when it ran
        {accuracy.asOfMatchday != null && ` · predicted from matchday ${accuracy.asOfMatchday}`}
      </p>

      <div className="accuracy-metrics">
        <div className="accuracy-metric">
          <span className="accuracy-metric-value">{accuracy.brierScore.toFixed(3)}</span>
          <span className="accuracy-metric-label">Brier</span>
          <span className="accuracy-metric-note">guess 0.667 · lower better</span>
        </div>
        <div className="accuracy-metric">
          <span className={`accuracy-metric-value ${skillTone(accuracy.skillScore)}`}>
            {signed(accuracy.skillScore)}
          </span>
          <span className="accuracy-metric-label">Skill</span>
          <span className="accuracy-metric-note">vs a 1/3-each guess</span>
        </div>
        <div className="accuracy-metric">
          <span className="accuracy-metric-value">{accuracy.logLoss.toFixed(3)}</span>
          <span className="accuracy-metric-label">Log loss</span>
          <span className="accuracy-metric-note">guess 1.099 · lower better</span>
        </div>
        <div className="accuracy-metric">
          <span className="accuracy-metric-value">{pct(accuracy.outcomeHitRate)}</span>
          <span className="accuracy-metric-label">Outcome</span>
          <span className="accuracy-metric-note">W/D/L called right</span>
        </div>
        <div className="accuracy-metric">
          <span className="accuracy-metric-value">{pct(accuracy.scorelineHitRate)}</span>
          <span className="accuracy-metric-label">Exact</span>
          <span className="accuracy-metric-note">scoreline on the nose</span>
        </div>
      </div>

      {accuracy.byMatchday.length > 1 && (
        <div className="accuracy-table-wrap">
          <table className="accuracy-table">
            <thead>
              <tr>
                <th>MD</th>
                <th>Graded</th>
                <th>Brier</th>
                <th>Outcome</th>
                <th>Exact</th>
              </tr>
            </thead>
            <tbody>
              {accuracy.byMatchday.map((row) => (
                <tr key={row.matchday}>
                  <td>{row.matchday}</td>
                  <td>{row.graded}</td>
                  <td>{row.brierScore.toFixed(3)}</td>
                  <td>{pct(row.outcomeHitRate)}</td>
                  <td>{pct(row.scorelineHitRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {accuracy.calibration.length > 0 && (
        <>
          <p className="modal-hint accuracy-calibration-hint">
            Calibration — things called 30% likely should happen about 30% of the time.
          </p>
          <div className="accuracy-table-wrap">
            <table className="accuracy-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>N</th>
                  <th>Predicted</th>
                  <th>Observed</th>
                </tr>
              </thead>
              <tbody>
                {accuracy.calibration.map((bin) => (
                  <tr key={bin.lowerEdge}>
                    <td>
                      {Math.round(bin.lowerEdge * 100)}–{Math.round(bin.lowerEdge * 100) + 10}%
                    </td>
                    <td>{bin.count}</td>
                    <td>{pct(bin.meanPredicted)}</td>
                    <td>{pct(bin.observedRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="modal-hint accuracy-matches-hint">
        Every graded fixture. <span className="accuracy-good">Green</span> got the scoreline
        exactly, <span className="accuracy-even">amber</span> got the result only.
      </p>
      <div className="accuracy-table-wrap accuracy-matches-wrap">
        <table className="accuracy-table">
          <thead>
            <tr>
              <th>MD</th>
              <th>Fixture</th>
              <th>Predicted</th>
              <th>Actual</th>
              <th>P(actual)</th>
            </tr>
          </thead>
          <tbody>
            {accuracy.matches.map((match) => (
              <tr
                key={match.matchNumber}
                className={
                  match.scorelineHit
                    ? 'accuracy-row-exact'
                    : match.outcomeHit
                      ? 'accuracy-row-outcome'
                      : ''
                }
              >
                <td>{match.matchday}</td>
                <td className="accuracy-fixture">
                  {match.homeTeam} v {match.awayTeam}
                </td>
                <td>
                  {match.predictedScoreline
                    ? `${match.predictedScoreline.goalsHome}–${match.predictedScoreline.goalsAway}`
                    : '—'}
                </td>
                <td>
                  {match.actual.goalsHome}–{match.actual.goalsAway}
                </td>
                <td>{pct(match.probabilities[match.actualOutcome])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
