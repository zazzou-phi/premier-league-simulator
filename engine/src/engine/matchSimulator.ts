import type { Team } from './types.js';
import { ELO_SCALE } from './teamRatings.js';

export interface RandomSource {
  random(): number;
}

export const defaultRandomSource: RandomSource = {
  random: () => Math.random(),
};

/**
 * Even-match expected goals per side, averaged over 2021/22–2024/25 (380 matches each).
 * Home: (1.51 + 1.80 + 1.63 + 1.51) / 4; away: (1.42 + 1.48 + 1.22 + 1.31) / 4.
 */
export const DEFAULT_BASELINE_HOME = 1.6125;
export const DEFAULT_BASELINE_AWAY = 1.3575;
export const DEFAULT_MATCH_TOTAL = DEFAULT_BASELINE_HOME + DEFAULT_BASELINE_AWAY;

/** How many goals an Elo gap of {@link ELO_SCALE} is worth in the lambda split. */
export const DEFAULT_ELO_GOAL_SCALE = 1;

/** Floor for each side's expected goals so extreme mismatches stay simulatable. */
export const MIN_LAMBDA = 0.05;

/** Log-normal sigma for per-team match form; 0 disables upset variance. */
export const DEFAULT_UPSET_VARIANCE = 0.2;

export interface MatchSimulationOptions {
  baselineHome?: number;
  baselineAway?: number;
  eloGoalScale?: number;
  upsetVariance?: number;
  rng?: RandomSource;
}

export interface SimulatedMatchOutcome {
  homeTeamId: number;
  awayTeamId: number;
  lambdaHome: number;
  lambdaAway: number;
  goalsHome: number;
  goalsAway: number;
}

export function sampleNormal(rng: RandomSource): number {
  const u1 = Math.max(rng.random(), Number.EPSILON);
  const u2 = rng.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-normal multiplier with mean 1 — models a team over- or under-performing for one match. */
export function sampleLogNormalMean1(rng: RandomSource, sigma: number): number {
  if (sigma <= 0) return 1;
  const z = sampleNormal(rng);
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}

export function samplePoisson(lambda: number, rng: RandomSource): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.random();
  } while (p > L);
  return k - 1;
}

/**
 * Elo sets the goal gap; fixed home/away baselines set the match total. Unclamped matches
 * satisfy λ_home + λ_away = baselineHome + baselineAway.
 */
export function computeMatchLambdas(
  home: Team,
  away: Team,
  baselineHome: number = DEFAULT_BASELINE_HOME,
  baselineAway: number = DEFAULT_BASELINE_AWAY,
  eloGoalScale: number = DEFAULT_ELO_GOAL_SCALE,
): { lambdaHome: number; lambdaAway: number } {
  const delta = (eloGoalScale * (home.elo - away.elo)) / ELO_SCALE;
  return {
    lambdaHome: Math.max(MIN_LAMBDA, baselineHome + delta / 2),
    lambdaAway: Math.max(MIN_LAMBDA, baselineAway - delta / 2),
  };
}

export function simulateMatchOutcome(
  home: Team,
  away: Team,
  options: MatchSimulationOptions = {},
): SimulatedMatchOutcome {
  const baselineHome = options.baselineHome ?? DEFAULT_BASELINE_HOME;
  const baselineAway = options.baselineAway ?? DEFAULT_BASELINE_AWAY;
  const eloGoalScale = options.eloGoalScale ?? DEFAULT_ELO_GOAL_SCALE;
  const upsetVariance = options.upsetVariance ?? DEFAULT_UPSET_VARIANCE;
  const rng = options.rng ?? defaultRandomSource;

  let { lambdaHome, lambdaAway } = computeMatchLambdas(
    home,
    away,
    baselineHome,
    baselineAway,
    eloGoalScale,
  );

  if (upsetVariance > 0) {
    const homeForm = sampleLogNormalMean1(rng, upsetVariance);
    const awayForm = sampleLogNormalMean1(rng, upsetVariance);
    // E[a/b] for two mean-1 log-normals is exp(sigma^2), so the ratio is rescaled to
    // keep expected goals fixed as upset variance changes.
    const ratioCorrection = Math.exp(upsetVariance * upsetVariance);
    lambdaHome *= homeForm / awayForm / ratioCorrection;
    lambdaAway *= awayForm / homeForm / ratioCorrection;
  }

  return {
    homeTeamId: home.id,
    awayTeamId: away.id,
    lambdaHome,
    lambdaAway,
    goalsHome: samplePoisson(lambdaHome, rng),
    goalsAway: samplePoisson(lambdaAway, rng),
  };
}
