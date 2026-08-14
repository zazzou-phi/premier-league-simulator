/**
 * Fits home and away expected goals independently from historical results.
 *
 * The model is a pair of log-link Poisson regressions:
 *
 *   log lambda_home = aHome + bHome * eloDiff + cHome * driftDiff
 *   log lambda_away = aAway + bAway * eloDiff + cAway * driftDiff
 *
 * where `eloDiff` is the clubelo rating gap on the day of the match (already reflecting every
 * result to date) and `driftDiff` is the gap in in-season Elo drift accumulated from a
 * season-start baseline by the engine's own {@link matchEloDelta}.
 *
 * This is "option C": clubelo's point-in-time rating and the engine's drift are both offered
 * to the model, and the fit decides how much each is worth. The engine currently applies both
 * — `effectiveElo = base + weight * drift` on top of a base that `fetch:ratings` refreshes
 * from clubelo — so if clubelo already prices in-season form, `driftDiff` is redundant and
 * its coefficient should land near zero.
 *
 * The engine's drift weight `w` multiplies the Elo slope, making `w * b` a product of two
 * unknowns and the joint likelihood non-convex. Fitting `c = b * w` as a free column instead
 * keeps the problem a plain linear GLM with a global optimum, and `w` is recovered afterwards
 * as `c / b`. Home and away share no parameters, so they are two independent 3-column fits.
 */
import { ELO_SCALE } from '../engine/teamRatings.js';
import { DEFAULT_SEASON_ELO_K, matchEloDelta } from '../engine/seasonElo.js';
import { eloOn, type HistoricalDataset, type HistoricalMatch } from './historicalData.js';
import type { MatchMeans } from './mixedPoisson.js';
import { fitPoissonLog, poissonLogLikelihood, type PoissonGlmFit } from './poissonGlm.js';

export interface TrainingRow extends HistoricalMatch {
  /** clubelo rating gap on the match date, in units of {@link ELO_SCALE}. */
  eloDiff: number;
  /** In-season drift gap at the start of the matchday, in units of {@link ELO_SCALE}. */
  driftDiff: number;
}

export interface BuildTrainingRowsOptions {
  /** K factor for the engine's in-season Elo drift. */
  eloK?: number;
}

/**
 * Joins results to point-in-time ratings and replays in-season drift.
 *
 * Drift is frozen at the start of each matchday, matching how the season simulator refreshes
 * form on matchday boundaries rather than after every individual match.
 */
export function buildTrainingRows(
  dataset: HistoricalDataset,
  options: BuildTrainingRowsOptions = {},
): TrainingRow[] {
  const eloK = options.eloK ?? DEFAULT_SEASON_ELO_K;
  const { matches, eloHistory } = dataset;

  const seasons = [...new Set(matches.map((match) => match.season))].sort((a, b) => a - b);
  const rows: TrainingRow[] = [];

  for (const season of seasons) {
    const seasonMatches = matches
      .filter((match) => match.season === season)
      .sort((a, b) => a.matchday - b.matchday || a.date.localeCompare(b.date));
    if (seasonMatches.length === 0) continue;

    // Baseline for drift: where clubelo had each club when the season kicked off.
    const seasonStart = seasonMatches[0]!.date;
    const baseElo = new Map<string, number>();
    const drift = new Map<string, number>();
    for (const club of new Set(seasonMatches.flatMap((m) => [m.homeClub, m.awayClub]))) {
      baseElo.set(club, eloOn(eloHistory, club, seasonStart));
      drift.set(club, 0);
    }

    const matchdays = [...new Set(seasonMatches.map((match) => match.matchday))].sort(
      (a, b) => a - b,
    );

    for (const matchday of matchdays) {
      const dayMatches = seasonMatches.filter((match) => match.matchday === matchday);

      // Every match on a matchday sees the same start-of-day drift.
      for (const match of dayMatches) {
        rows.push({
          ...match,
          eloDiff:
            (eloOn(eloHistory, match.homeClub, match.date) -
              eloOn(eloHistory, match.awayClub, match.date)) /
            ELO_SCALE,
          driftDiff: (drift.get(match.homeClub)! - drift.get(match.awayClub)!) / ELO_SCALE,
        });
      }

      for (const match of dayMatches) {
        const homeElo = baseElo.get(match.homeClub)! + drift.get(match.homeClub)!;
        const awayElo = baseElo.get(match.awayClub)! + drift.get(match.awayClub)!;
        const [homeDelta, awayDelta] = matchEloDelta(
          homeElo,
          awayElo,
          match.goalsHome,
          match.goalsAway,
          eloK,
        );
        drift.set(match.homeClub, drift.get(match.homeClub)! + homeDelta);
        drift.set(match.awayClub, drift.get(match.awayClub)! + awayDelta);
      }
    }
  }

  return rows;
}

/** Columns are `[intercept, eloDiff, driftDiff]`, dropping the last when drift is excluded. */
export function designMatrix(rows: TrainingRow[], includeDrift: boolean): number[][] {
  return rows.map((row) =>
    includeDrift ? [1, row.eloDiff, row.driftDiff] : [1, row.eloDiff],
  );
}

export interface SideFit {
  fit: PoissonGlmFit;
  /** Expected goals for this side in a fixture between equally rated clubs. */
  baseline: number;
  /** Elo slope on the log scale. */
  eloCoefficient: number;
  /** Drift coefficient `c = b * w`; absent when drift is excluded. */
  driftCoefficient: number | null;
  /**
   * Drift weight implied by `c / b`, comparable to the engine's `seasonEloDeltaWeight`.
   * Null when drift is excluded or the Elo slope is too near zero to divide by.
   */
  impliedDriftWeight: number | null;
}

function summarizeSide(fit: PoissonGlmFit, includeDrift: boolean): SideFit {
  const intercept = fit.beta[0]!;
  const eloCoefficient = fit.beta[1]!;
  const driftCoefficient = includeDrift ? fit.beta[2]! : null;

  return {
    fit,
    baseline: Math.exp(intercept),
    eloCoefficient,
    driftCoefficient,
    impliedDriftWeight:
      driftCoefficient != null && Math.abs(eloCoefficient) > 1e-6
        ? driftCoefficient / eloCoefficient
        : null,
  };
}

export interface LikelihoodRatioTest {
  statistic: number;
  degreesOfFreedom: number;
  /** Upper-tail chi-squared probability of a statistic this large under the null. */
  pValue: number;
}

/** Upper-tail chi-squared probability, for the small degrees of freedom used here. */
export function chiSquaredUpperTail(statistic: number, degreesOfFreedom: number): number {
  if (statistic <= 0) return 1;
  if (degreesOfFreedom === 1) {
    // 2 * (1 - Phi(sqrt(x))), with Phi via the error function.
    return erfc(Math.sqrt(statistic / 2));
  }
  if (degreesOfFreedom === 2) return Math.exp(-statistic / 2);
  if (degreesOfFreedom === 3) {
    return (
      erfc(Math.sqrt(statistic / 2)) +
      Math.sqrt((2 * statistic) / Math.PI) * Math.exp(-statistic / 2)
    );
  }
  throw new Error(
    `chiSquaredUpperTail supports 1 to 3 degrees of freedom, got ${degreesOfFreedom}`,
  );
}

/** Abramowitz & Stegun 7.1.26, accurate to ~1e-7 — ample for reporting a p-value. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const value =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? value : 2 - value;
}

export interface LambdaModelFit {
  rows: number;
  home: SideFit;
  away: SideFit;
  /** Joint test that both drift coefficients are zero. */
  driftTest: LikelihoodRatioTest | null;
  logLikelihood: number;
}

export function fitLambdaModel(rows: TrainingRow[], includeDrift = true): LambdaModelFit {
  const x = designMatrix(rows, includeDrift);
  const goalsHome = rows.map((row) => row.goalsHome);
  const goalsAway = rows.map((row) => row.goalsAway);

  const homeFit = fitPoissonLog(x, goalsHome);
  const awayFit = fitPoissonLog(x, goalsAway);
  const logLikelihood = homeFit.logLikelihood + awayFit.logLikelihood;

  let driftTest: LikelihoodRatioTest | null = null;
  if (includeDrift) {
    const reduced = designMatrix(rows, false);
    const reducedLogLikelihood =
      fitPoissonLog(reduced, goalsHome).logLikelihood +
      fitPoissonLog(reduced, goalsAway).logLikelihood;
    const statistic = 2 * (logLikelihood - reducedLogLikelihood);
    driftTest = {
      statistic,
      degreesOfFreedom: 2,
      pValue: chiSquaredUpperTail(statistic, 2),
    };
  }

  return {
    rows: rows.length,
    home: summarizeSide(homeFit, includeDrift),
    away: summarizeSide(awayFit, includeDrift),
    driftTest,
    logLikelihood,
  };
}

/**
 * Stage-1 expected goals for each row, in the form the stage-2 shape fit consumes.
 *
 * These are means, not rates for a particular match realisation: the stage-2 shocks are all
 * mean-1, so they scatter goals around these values without moving them.
 */
export function predictMeans(
  fit: LambdaModelFit,
  rows: TrainingRow[],
  includeDrift = true,
): MatchMeans[] {
  const x = designMatrix(rows, includeDrift);
  const rate = (beta: number[], row: number[]) => {
    let eta = 0;
    for (let j = 0; j < beta.length; j++) eta += row[j]! * beta[j]!;
    return Math.exp(eta);
  };

  return rows.map((row, i) => ({
    muHome: rate(fit.home.fit.beta, x[i]!),
    muAway: rate(fit.away.fit.beta, x[i]!),
    goalsHome: row.goalsHome,
    goalsAway: row.goalsAway,
  }));
}

/** Mean per-match log-likelihood of `rows` under an already-fitted model. */
export function evaluateLogLikelihood(
  fit: LambdaModelFit,
  rows: TrainingRow[],
  includeDrift = true,
): number {
  if (rows.length === 0) return Number.NaN;
  const x = designMatrix(rows, includeDrift);
  const home = poissonLogLikelihood(x, rows.map((row) => row.goalsHome), fit.home.fit.beta);
  const away = poissonLogLikelihood(x, rows.map((row) => row.goalsAway), fit.away.fit.beta);
  return (home + away) / rows.length;
}

export interface RollingOriginResult {
  /** Origins actually evaluated, after skipping those with too little training data. */
  origins: number;
  evaluated: number;
  /** Mean out-of-sample per-match log-likelihood, drift column included. */
  withDrift: number;
  /** The same, with drift excluded — the comparison that says whether drift earns its place. */
  withoutDrift: number;
}

export interface RollingOriginOptions {
  /** Minimum training rows before an origin is scored. */
  minTrainingRows?: number;
}

/**
 * Walk-forward evaluation: at each matchday boundary, fit on everything already played and
 * score the matchday that follows. Nothing from the future reaches the training set, which is
 * the only way to see whether drift adds signal rather than just absorbing it in-sample.
 */
export function rollingOriginEvaluation(
  rows: TrainingRow[],
  options: RollingOriginOptions = {},
): RollingOriginResult {
  const minTrainingRows = options.minTrainingRows ?? 380;

  const ordered = [...rows].sort(
    (a, b) => a.season - b.season || a.matchday - b.matchday || a.date.localeCompare(b.date),
  );

  const boundaries = [
    ...new Map(
      ordered.map((row) => [`${row.season}-${row.matchday}`, { season: row.season, matchday: row.matchday }]),
    ).values(),
  ];

  let evaluated = 0;
  let withDrift = 0;
  let withoutDrift = 0;

  for (const boundary of boundaries) {
    const isBefore = (row: TrainingRow) =>
      row.season < boundary.season ||
      (row.season === boundary.season && row.matchday < boundary.matchday);

    const train = ordered.filter(isBefore);
    if (train.length < minTrainingRows) continue;

    const test = ordered.filter(
      (row) => row.season === boundary.season && row.matchday === boundary.matchday,
    );
    if (test.length === 0) continue;

    withDrift += evaluateLogLikelihood(fitLambdaModel(train, true), test, true);
    withoutDrift += evaluateLogLikelihood(fitLambdaModel(train, false), test, false);
    evaluated += 1;
  }

  return {
    origins: boundaries.length,
    evaluated,
    withDrift: evaluated === 0 ? Number.NaN : withDrift / evaluated,
    withoutDrift: evaluated === 0 ? Number.NaN : withoutDrift / evaluated,
  };
}
