import { calibratedPicksFor } from './calibratedPicks.js';
import {
  choosePick,
  outcomeFromScoreline,
  type PickStrategy,
  type MatchOutcome,
  type ScoringRules,
  type ScorelineCount,
} from './pickStrategy.js';
import type { Fixture, Team } from './types.js';

/**
 * Grading a stored prediction against the results that actually landed.
 *
 * Only fixtures that were *unplayed* when the batch ran are gradeable: Monte Carlo replays
 * locked results verbatim, so a locked fixture's distribution is a restatement of a known
 * score and would flatter every metric. Callers pass that set in as `lockedAtRunTime`.
 */

export const OUTCOMES: MatchOutcome[] = ['homeWin', 'draw', 'awayWin'];

/** Brier for a three-outcome forecast that puts everything on one class. */
export const BRIER_MAX = 2;

/** A uniform 1/3 guess: 2 x (1/3)^2 + (2/3)^2. */
export const UNIFORM_BRIER = 2 / 3;

export interface OutcomeProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface MatchAccuracy {
  matchNumber: number;
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  probabilities: OutcomeProbabilities;
  actual: { goalsHome: number; goalsAway: number };
  actualOutcome: MatchOutcome;
  /** Outcome the picked scoreline implied — what the app displayed. */
  predictedOutcome: MatchOutcome | null;
  predictedScoreline: { goalsHome: number; goalsAway: number } | null;
  outcomeHit: boolean;
  scorelineHit: boolean;
  /** Share of runs that produced exactly the scoreline that happened. */
  scorelineProbability: number;
  brier: number;
  logLoss: number;
}

export interface MatchdayAccuracy {
  matchday: number;
  graded: number;
  brierScore: number;
  logLoss: number;
  outcomeHitRate: number;
  scorelineHitRate: number;
}

export interface CalibrationBin {
  /** Inclusive lower edge of the predicted-probability bucket, e.g. 0.3 for 30–40%. */
  lowerEdge: number;
  /** Forecast/observation pairs falling in this bucket (three per graded match). */
  count: number;
  meanPredicted: number;
  observedRate: number;
}

export interface AccuracyReport {
  graded: number;
  /** Fixtures the batch was told the answer to, excluded from every metric. */
  skippedLocked: number;
  /** Gradeable fixtures with no result yet. */
  pending: number;
  brierScore: number;
  uniformBrierScore: number;
  /** 1 - brier/uniform. Positive means the model beat a 1/3-each guess. */
  skillScore: number;
  logLoss: number;
  outcomeHitRate: number;
  scorelineHitRate: number;
  byMatchday: MatchdayAccuracy[];
  calibration: CalibrationBin[];
  matches: MatchAccuracy[];
}

export interface GradeablePrediction {
  pickStrategy: PickStrategy;
  fixtures: Fixture[];
  teamsById: Map<number, Team>;
  distributions: Map<
    number,
    { outcomes: { homeWin: number; draw: number; awayWin: number; total: number }; scorelines: ScorelineCount[] }
  >;
  actuals: Map<number, { goalsHome: number; goalsAway: number }>;
  lockedAtRunTime: Set<number>;
  /** Result for each fixture from the active sampled season; used by the `random` strategy. */
  activeSample?: Map<number, { goalsHome: number; goalsAway: number }> | null;
  /** Predictor-game payoff; used by the `maxPoints` strategy. */
  rules?: ScoringRules;
}

export function outcomeOf(goalsHome: number, goalsAway: number): MatchOutcome {
  return outcomeFromScoreline({ goalsHome, goalsAway });
}

/**
 * Multi-category Brier: summed squared error across the three outcomes. 0 is perfect,
 * 2 is maximally wrong, 2/3 is a uniform guess. Lower is better.
 */
export function brierScore(probabilities: OutcomeProbabilities, actual: MatchOutcome): number {
  return OUTCOMES.reduce((sum, outcome) => {
    const observed = outcome === actual ? 1 : 0;
    const error = probabilities[outcome] - observed;
    return sum + error * error;
  }, 0);
}

/**
 * -ln P(actual). A finite batch can assign an outcome zero runs, which would make this
 * infinite, so probabilities are floored at half a run — the resolution the batch actually
 * has. Lower is better.
 */
export function logLoss(probabilities: OutcomeProbabilities, actual: MatchOutcome, runs: number): number {
  const floor = runs > 0 ? 1 / (2 * runs) : 1e-9;
  // max(0, …) rather than the bare negation, so a probability of 1 reports 0 and not -0.
  return Math.max(0, -Math.log(Math.max(probabilities[actual], floor)));
}

function toProbabilities(counts: {
  homeWin: number;
  draw: number;
  awayWin: number;
  total: number;
}): OutcomeProbabilities {
  const total = counts.total || 1;
  return {
    homeWin: counts.homeWin / total,
    draw: counts.draw / total,
    awayWin: counts.awayWin / total,
  };
}

const CALIBRATION_BIN_COUNT = 10;

/**
 * Reliability curve: bucket every forecast probability by decile and compare it with how
 * often that outcome actually happened. A well-calibrated model sits on the diagonal —
 * things it called 30% likely happen about 30% of the time.
 */
export function buildCalibration(matches: MatchAccuracy[]): CalibrationBin[] {
  const bins = Array.from({ length: CALIBRATION_BIN_COUNT }, () => ({
    count: 0,
    predictedSum: 0,
    observed: 0,
  }));

  for (const match of matches) {
    for (const outcome of OUTCOMES) {
      const probability = match.probabilities[outcome];
      const index = Math.min(
        CALIBRATION_BIN_COUNT - 1,
        Math.floor(probability * CALIBRATION_BIN_COUNT),
      );
      const bin = bins[index]!;
      bin.count += 1;
      bin.predictedSum += probability;
      if (match.actualOutcome === outcome) bin.observed += 1;
    }
  }

  return bins.flatMap((bin, index) =>
    bin.count === 0
      ? []
      : [
          {
            lowerEdge: index / CALIBRATION_BIN_COUNT,
            count: bin.count,
            meanPredicted: bin.predictedSum / bin.count,
            observedRate: bin.observed / bin.count,
          },
        ],
  );
}

function summarize(matches: MatchAccuracy[]): Omit<MatchdayAccuracy, 'matchday'> {
  const graded = matches.length;
  if (graded === 0) {
    return { graded: 0, brierScore: 0, logLoss: 0, outcomeHitRate: 0, scorelineHitRate: 0 };
  }
  const mean = (pick: (match: MatchAccuracy) => number) =>
    matches.reduce((sum, match) => sum + pick(match), 0) / graded;

  return {
    graded,
    brierScore: mean((match) => match.brier),
    logLoss: mean((match) => match.logLoss),
    outcomeHitRate: mean((match) => (match.outcomeHit ? 1 : 0)),
    scorelineHitRate: mean((match) => (match.scorelineHit ? 1 : 0)),
  };
}

/** Grade one stored batch against reality. */
export function gradePrediction(input: GradeablePrediction, runs: number): AccuracyReport {
  const matches: MatchAccuracy[] = [];
  let skippedLocked = 0;
  let pending = 0;

  // Solved over the whole fixture list, including the locked ones. Their distributions are
  // degenerate, so they pin themselves and contribute their known result to the targets — which
  // is what keeps a batch's picks stable as results land.
  const calibrated =
    input.pickStrategy === 'calibrated'
      ? calibratedPicksFor(input.fixtures, input.distributions)
      : null;

  for (const fixture of input.fixtures) {
    if (input.lockedAtRunTime.has(fixture.matchNumber)) {
      skippedLocked += 1;
      continue;
    }

    const actual = input.actuals.get(fixture.matchNumber);
    if (!actual) {
      pending += 1;
      continue;
    }

    const distribution = input.distributions.get(fixture.matchNumber);
    if (!distribution) continue;

    const teamHome = input.teamsById.get(fixture.teamHomeId);
    const teamAway = input.teamsById.get(fixture.teamAwayId);
    if (!teamHome || !teamAway) continue;

    const probabilities = toProbabilities(distribution.outcomes);
    const actualOutcome = outcomeOf(actual.goalsHome, actual.goalsAway);

    const predictedScoreline = choosePick({
      strategy: input.pickStrategy,
      outcomeCounts: distribution.outcomes,
      scorelines: distribution.scorelines,
      homeElo: teamHome.elo,
      awayElo: teamAway.elo,
      savedSample: input.activeSample?.get(fixture.matchNumber) ?? null,
      calibratedPick: calibrated?.get(fixture.matchNumber) ?? null,
      rules: input.rules,
    });

    const scorelineHits = distribution.scorelines.find(
      (scoreline) =>
        scoreline.goalsHome === actual.goalsHome && scoreline.goalsAway === actual.goalsAway,
    );

    matches.push({
      matchNumber: fixture.matchNumber,
      matchday: fixture.matchday,
      homeTeam: teamHome.name,
      awayTeam: teamAway.name,
      probabilities,
      actual,
      actualOutcome,
      predictedOutcome: predictedScoreline ? outcomeFromScoreline(predictedScoreline) : null,
      predictedScoreline,
      outcomeHit: predictedScoreline
        ? outcomeFromScoreline(predictedScoreline) === actualOutcome
        : false,
      scorelineHit:
        predictedScoreline != null &&
        predictedScoreline.goalsHome === actual.goalsHome &&
        predictedScoreline.goalsAway === actual.goalsAway,
      scorelineProbability: (scorelineHits?.n ?? 0) / (distribution.outcomes.total || 1),
      brier: brierScore(probabilities, actualOutcome),
      logLoss: logLoss(probabilities, actualOutcome, runs),
    });
  }

  matches.sort((a, b) => a.matchNumber - b.matchNumber);

  const overall = summarize(matches);
  const matchdays = [...new Set(matches.map((match) => match.matchday))].sort((a, b) => a - b);

  return {
    ...overall,
    skippedLocked,
    pending,
    uniformBrierScore: UNIFORM_BRIER,
    skillScore: overall.graded === 0 ? 0 : 1 - overall.brierScore / UNIFORM_BRIER,
    byMatchday: matchdays.map((matchday) => ({
      matchday,
      ...summarize(matches.filter((match) => match.matchday === matchday)),
    })),
    calibration: buildCalibration(matches),
    matches,
  };
}
