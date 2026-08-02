import type { Prediction, PredictionAccuracy, Repository } from '../db/repository.js';

/**
 * Most recent batch that has something to grade — i.e. one that predicted at least one
 * fixture blind that has since been played. Newest first, so the usual answer is "last
 * week's projection".
 */
export function pickGradeablePrediction(repo: Repository): Prediction | null {
  const { items } = repo.listPredictions(1, 100);
  const byRecency = [...items].sort((a, b) => b.id - a.id);
  return byRecency.find((prediction) => repo.countGradeableMatches(prediction.id) > 0) ?? null;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function verdict(skillScore: number): string {
  if (skillScore >= 0.15) return 'clearly better than a coin-toss guess';
  if (skillScore >= 0.05) return 'modestly better than a coin-toss guess';
  if (skillScore > -0.05) return 'about as good as guessing 1/3 each';
  return 'worse than guessing 1/3 each — check upset variance and Elo drift';
}

export function formatAccuracyReport(report: PredictionAccuracy, showMatches = false): string {
  const lines: string[] = [];
  const heading = `#${report.predictionId} "${report.name}"`;
  const scope =
    report.asOfMatchday != null ? ` — predicted from matchday ${report.asOfMatchday}` : '';

  lines.push(heading + scope);
  lines.push('-'.repeat(Math.max(40, heading.length + scope.length)));

  if (report.graded === 0) {
    lines.push('Nothing to grade yet: no fixture it predicted blind has been played.');
    return lines.join('\n');
  }

  lines.push(
    `Graded ${report.graded} matches (${report.pending} still to play, ` +
      `${report.skippedLocked} already known when it ran)`,
  );
  lines.push('');
  lines.push(`Brier score      ${report.brierScore.toFixed(4)}  (uniform guess 0.6667, lower is better)`);
  lines.push(`Skill score      ${report.skillScore >= 0 ? '+' : ''}${report.skillScore.toFixed(4)}  ${verdict(report.skillScore)}`);
  lines.push(`Log loss         ${report.logLoss.toFixed(4)}  (uniform guess 1.0986, lower is better)`);
  lines.push(`Outcome hit rate ${pct(report.outcomeHitRate)}`);
  lines.push(`Exact scoreline  ${pct(report.scorelineHitRate)}`);

  if (report.byMatchday.length > 1) {
    lines.push('');
    lines.push(' MD  Graded   Brier   LogLoss   Outcome   Exact');
    lines.push('-'.repeat(48));
    for (const row of report.byMatchday) {
      lines.push(
        `${String(row.matchday).padStart(3)}  ${String(row.graded).padStart(6)}  ` +
          `${row.brierScore.toFixed(4)}   ${row.logLoss.toFixed(4)}   ` +
          `${pct(row.outcomeHitRate).padStart(7)}  ${pct(row.scorelineHitRate).padStart(6)}`,
      );
    }
  }

  if (report.calibration.length > 0) {
    lines.push('');
    lines.push('Calibration (predicted vs observed, all three outcomes pooled)');
    lines.push('  Bucket    N   Predicted   Observed');
    lines.push('-'.repeat(42));
    for (const bin of report.calibration) {
      const label = `${Math.round(bin.lowerEdge * 100)}-${Math.round(bin.lowerEdge * 100) + 10}%`;
      lines.push(
        `  ${label.padEnd(8)}${String(bin.count).padStart(4)}   ` +
          `${pct(bin.meanPredicted).padStart(8)}   ${pct(bin.observedRate).padStart(8)}`,
      );
    }
  }

  if (showMatches) {
    lines.push('');
    lines.push('Match                                       Predicted   Actual   P(actual)');
    lines.push('-'.repeat(76));
    for (const match of report.matches) {
      const fixture = `${match.homeTeam} v ${match.awayTeam}`;
      const predicted = match.predictedScoreline
        ? `${match.predictedScoreline.goalsHome}-${match.predictedScoreline.goalsAway}`
        : '—';
      const actual = `${match.actual.goalsHome}-${match.actual.goalsAway}`;
      const marker = match.scorelineHit ? '**' : match.outcomeHit ? ' *' : '  ';
      lines.push(
        `${marker} ${fixture.padEnd(40).slice(0, 40)}  ${predicted.padStart(8)}   ` +
          `${actual.padStart(6)}   ${pct(match.probabilities[match.actualOutcome]).padStart(8)}`,
      );
    }
    lines.push('');
    lines.push('  ** exact scoreline   * right outcome');
  }

  return lines.join('\n');
}
