import type { Team } from './types.js';
import { ELO_SCALE } from './teamRatings.js';

export interface RandomSource {
  random(): number;
}

export const defaultRandomSource: RandomSource = {
  random: () => Math.random(),
};

/**
 * Even-match expected goals per side: the fitted rate when two equally rated clubs meet.
 *
 * Maximum-likelihood estimates from a log-link Poisson fit over 2021/22–2025/26 (1900
 * matches), against clubelo ratings as they stood on each match date. See
 * `engine/src/fitting` and `npm run fit:lambdas`.
 */
export const DEFAULT_BASELINE_HOME = 1.5292;
export const DEFAULT_BASELINE_AWAY = 1.2757;

/** Expected goals in an even fixture. Not an invariant — see {@link computeMatchLambdas}. */
export const DEFAULT_EVEN_MATCH_TOTAL = DEFAULT_BASELINE_HOME + DEFAULT_BASELINE_AWAY;

/**
 * Log-scale response of each side's expected goals to an Elo gap of {@link ELO_SCALE}.
 *
 * Fitted alongside the baselines (standard errors 0.045 and 0.050). The two are close to
 * equal and opposite but are estimated separately, which is what lets the match total vary
 * with the mismatch instead of being pinned.
 */
export const DEFAULT_ELO_SLOPE_HOME = 0.7388;
export const DEFAULT_ELO_SLOPE_AWAY = -0.7218;

/**
 * Log-normal sigma for per-team match form; 0 disables upset variance.
 *
 * Fitted to zero. Adding a mean-1 multiplicative shock can only *increase* dispersion, and
 * league goals are already fractionally under-dispersed relative to Poisson at these fitted
 * rates (observed sd of total goals 1.662 against 1.722). The likelihood therefore falls
 * monotonically as sigma rises, and on a held-out season the old 0.2 default cost about
 * 0.016 nats per match against simply switching the shock off.
 *
 * That rules out this particular mechanism, not the idea of match-to-match variation: a
 * family that can represent under-dispersion might well beat plain Poisson here.
 */
export const DEFAULT_UPSET_VARIANCE = 0;

/**
 * Share of form variance that is *common* to both sides — match tempo (an open game or a
 * tight one) rather than one side being better on the day.
 *
 * Inert at the default, because {@link DEFAULT_UPSET_VARIANCE} is zero. It still matters to
 * anyone who raises the upset slider: a purely differential shock can only push the two
 * lambdas apart, so it erodes draws (at an even fixture, sigma 0 -> 0.5 moves the draw rate
 * -5.4pp at share 0, but only +0.7pp at share 0.6).
 */
export const DEFAULT_TEMPO_SHARE = 0.6;

export interface MatchSimulationOptions {
  baselineHome?: number;
  baselineAway?: number;
  eloSlopeHome?: number;
  eloSlopeAway?: number;
  upsetVariance?: number;
  /** 0 reproduces a pure-ratio shock; 1 makes the shock entirely common-mode. */
  tempoShare?: number;
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
 * Each side's expected goals as its own log-linear function of the Elo gap:
 *
 *   λ_home = baselineHome × exp(eloSlopeHome × gap)
 *   λ_away = baselineAway × exp(eloSlopeAway × gap)
 *
 * The match total is deliberately *not* fixed. Mismatches really are higher scoring — across
 * 2021/22–2025/26, fixtures inside a 100-point Elo gap averaged 2.84 goals while those beyond
 * 300 averaged 3.37 — and the previous additive split, which held every fixture at the same
 * total, could not express that.
 *
 * Being multiplicative, this also cannot produce a non-positive rate, so the old floor for
 * extreme mismatches is no longer needed.
 */
export function computeMatchLambdas(
  home: Team,
  away: Team,
  baselineHome: number = DEFAULT_BASELINE_HOME,
  baselineAway: number = DEFAULT_BASELINE_AWAY,
  eloSlopeHome: number = DEFAULT_ELO_SLOPE_HOME,
  eloSlopeAway: number = DEFAULT_ELO_SLOPE_AWAY,
): { lambdaHome: number; lambdaAway: number } {
  const gap = (home.elo - away.elo) / ELO_SCALE;
  return {
    lambdaHome: baselineHome * Math.exp(eloSlopeHome * gap),
    lambdaAway: baselineAway * Math.exp(eloSlopeAway * gap),
  };
}

export function simulateMatchOutcome(
  home: Team,
  away: Team,
  options: MatchSimulationOptions = {},
): SimulatedMatchOutcome {
  const baselineHome = options.baselineHome ?? DEFAULT_BASELINE_HOME;
  const baselineAway = options.baselineAway ?? DEFAULT_BASELINE_AWAY;
  const eloSlopeHome = options.eloSlopeHome ?? DEFAULT_ELO_SLOPE_HOME;
  const eloSlopeAway = options.eloSlopeAway ?? DEFAULT_ELO_SLOPE_AWAY;
  const upsetVariance = options.upsetVariance ?? DEFAULT_UPSET_VARIANCE;
  const tempoShare = Math.min(1, Math.max(0, options.tempoShare ?? DEFAULT_TEMPO_SHARE));
  const rng = options.rng ?? defaultRandomSource;

  let { lambdaHome, lambdaAway } = computeMatchLambdas(
    home,
    away,
    baselineHome,
    baselineAway,
    eloSlopeHome,
    eloSlopeAway,
  );

  if (upsetVariance > 0) {
    // Split the shock so each lambda keeps log-variance 2*sigma^2 regardless of the mix:
    // the differential term contributes 2*sigmaDiff^2 (it is a difference of two draws) and
    // the shared term sigmaShared^2, and 2*sigma^2*(1 - share) + 2*sigma^2*share = 2*sigma^2.
    const sigmaDiff = upsetVariance * Math.sqrt(1 - tempoShare);
    const sigmaShared = upsetVariance * Math.sqrt(2 * tempoShare);

    if (sigmaDiff > 0) {
      const homeForm = sampleLogNormalMean1(rng, sigmaDiff);
      const awayForm = sampleLogNormalMean1(rng, sigmaDiff);
      // E[a/b] for two mean-1 log-normals is exp(sigma^2), so the ratio is rescaled to
      // keep expected goals fixed as upset variance changes.
      const ratioCorrection = Math.exp(sigmaDiff * sigmaDiff);
      lambdaHome *= homeForm / awayForm / ratioCorrection;
      lambdaAway *= awayForm / homeForm / ratioCorrection;
    }

    if (sigmaShared > 0) {
      // One mean-1 draw applied to both sides, so it moves the match total without
      // touching the balance between the teams.
      const tempo = sampleLogNormalMean1(rng, sigmaShared);
      lambdaHome *= tempo;
      lambdaAway *= tempo;
    }
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
