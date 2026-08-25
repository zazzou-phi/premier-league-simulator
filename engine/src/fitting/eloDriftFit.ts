/**
 * Fits the in-season Elo update for the case where clubelo is *not* underneath it.
 *
 * `lambdaModel.ts` asks a different question. There, `eloDiff` is clubelo's rating on the day
 * of the match — already reflecting every result to date — and `driftDiff` is offered
 * alongside it. Drift rightly measures as worthless in that setup, because it is re-deriving
 * form the base rating has already absorbed. That is a test of whether to double-count.
 *
 * Here the base is *frozen* at each season's opening rating and drift is the only thing that
 * moves a club afterwards, which is the situation the engine is actually in once the clubelo
 * feed stops refreshing the base. The question becomes: replaying real results through
 * {@link matchEloDelta}, which K and which margin-of-victory scheme best predict the matchday
 * that has not happened yet?
 *
 * Scoring reuses the stage-1 Poisson fit, so a candidate is judged by the goals it implies
 * rather than by an Elo-internal metric the engine never consumes.
 */
import { ELO_SCALE } from '../engine/teamRatings.js';
import {
  DEFAULT_MOV_SCHEME,
  DEFAULT_SEASON_ELO_K,
  matchEloDelta,
  type MovScheme,
} from '../engine/seasonElo.js';
import { eloOn, type HistoricalDataset } from './historicalData.js';
import {
  evaluateLogLikelihood,
  fitLambdaModel,
  type TrainingRow,
} from './lambdaModel.js';

export interface AnchoredRowsOptions {
  eloK?: number;
  movScheme?: MovScheme;
  /** Multiplies drift before it is folded into the rating, mirroring `effectiveElo`. */
  driftWeight?: number;
  /**
   * When false, the anchor tracks clubelo on the match date and drift is ignored — the
   * pre-outage behaviour, kept as the ceiling a frozen anchor is trying to reach.
   */
  freezeAnchor?: boolean;
}

/**
 * One row per historical match, with `eloDiff` holding the *combined* rating gap that the
 * engine would have simulated from: frozen anchor plus weighted drift.
 *
 * `driftDiff` is left at zero throughout. Drift is not a separate column here — it is baked
 * into the rating, which is exactly how `effectiveElo` applies it at simulation time. Callers
 * therefore fit and score with `includeDrift = false`.
 *
 * Drift is frozen at the start of each matchday rather than applied match by match, matching
 * how the season simulator refreshes form on matchday boundaries.
 */
export function buildAnchoredRows(
  dataset: HistoricalDataset,
  options: AnchoredRowsOptions = {},
): TrainingRow[] {
  const {
    eloK = DEFAULT_SEASON_ELO_K,
    movScheme = DEFAULT_MOV_SCHEME,
    driftWeight = 1,
    freezeAnchor = true,
  } = options;

  const { matches, eloHistory } = dataset;
  const seasons = [...new Set(matches.map((match) => match.season))].sort((a, b) => a - b);
  const rows: TrainingRow[] = [];

  for (const season of seasons) {
    const seasonMatches = matches
      .filter((match) => match.season === season)
      .sort((a, b) => a.matchday - b.matchday || a.date.localeCompare(b.date));
    if (seasonMatches.length === 0) continue;

    // Each August re-anchors on clubelo's opening rating: the promoted clubs have no
    // in-league history to drift from, and last season's drift is not theirs to carry.
    const seasonStart = seasonMatches[0]!.date;
    const clubs = new Set(seasonMatches.flatMap((m) => [m.homeClub, m.awayClub]));
    const anchor = new Map<string, number>();
    const drift = new Map<string, number>();
    for (const club of clubs) {
      anchor.set(club, eloOn(eloHistory, club, seasonStart));
      drift.set(club, 0);
    }

    const ratingOn = (club: string, date: string) =>
      (freezeAnchor ? anchor.get(club)! : eloOn(eloHistory, club, date)) +
      driftWeight * drift.get(club)!;

    const matchdays = [...new Set(seasonMatches.map((match) => match.matchday))].sort(
      (a, b) => a - b,
    );

    for (const matchday of matchdays) {
      const dayMatches = seasonMatches.filter((match) => match.matchday === matchday);

      for (const match of dayMatches) {
        rows.push({
          ...match,
          eloDiff:
            (ratingOn(match.homeClub, match.date) - ratingOn(match.awayClub, match.date)) /
            ELO_SCALE,
          driftDiff: 0,
        });
      }

      // Drift accumulates on the unweighted rating, so `driftWeight` scales how far form is
      // allowed to move a club without also compounding into the next update.
      for (const match of dayMatches) {
        const [homeDelta, awayDelta] = matchEloDelta(
          anchor.get(match.homeClub)! + drift.get(match.homeClub)!,
          anchor.get(match.awayClub)! + drift.get(match.awayClub)!,
          match.goalsHome,
          match.goalsAway,
          eloK,
          { movScheme },
        );
        drift.set(match.homeClub, drift.get(match.homeClub)! + homeDelta);
        drift.set(match.awayClub, drift.get(match.awayClub)! + awayDelta);
      }
    }
  }

  return rows;
}

export interface AnchoredWalkForwardResult {
  evaluated: number;
  /** Mean out-of-sample per-match log-likelihood. Higher is better. */
  logLikelihood: number;
  /**
   * Score at each origin, in evaluation order. Candidates are scored on identical origins, so
   * differencing these pairwise is what separates a real gain from resampling noise — the
   * spread *between* candidates is far smaller than the spread across matchdays.
   */
  perOrigin: number[];
}

export interface PairedComparison {
  meanDifference: number;
  standardError: number;
  /** Paired t statistic; |t| under about 2 is indistinguishable from noise. */
  tStatistic: number;
  origins: number;
}

/**
 * Paired difference between two candidates scored on the same origins (`a` minus `b`).
 *
 * Origin-to-origin variance is large and common to both candidates, so the paired SE is the
 * only honest read on whether one K genuinely beats another.
 */
export function pairedComparison(
  a: AnchoredWalkForwardResult,
  b: AnchoredWalkForwardResult,
): PairedComparison {
  const n = Math.min(a.perOrigin.length, b.perOrigin.length);
  if (n < 2) {
    return { meanDifference: Number.NaN, standardError: Number.NaN, tStatistic: Number.NaN, origins: n };
  }

  const diffs = Array.from({ length: n }, (_, i) => a.perOrigin[i]! - b.perOrigin[i]!);
  const mean = diffs.reduce((sum, d) => sum + d, 0) / n;
  const variance = diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);

  return {
    meanDifference: mean,
    standardError,
    tStatistic: standardError === 0 ? Number.NaN : mean / standardError,
    origins: n,
  };
}

/**
 * Walk-forward over matchday boundaries: fit on everything already played, score the matchday
 * that follows. Nothing from the future reaches the training set.
 */
export function anchoredWalkForward(
  rows: TrainingRow[],
  minTrainingRows = 380,
): AnchoredWalkForwardResult {
  const ordered = [...rows].sort(
    (a, b) => a.season - b.season || a.matchday - b.matchday || a.date.localeCompare(b.date),
  );

  const boundaries = [
    ...new Map(
      ordered.map((row) => [
        `${row.season}-${row.matchday}`,
        { season: row.season, matchday: row.matchday },
      ]),
    ).values(),
  ];

  const perOrigin: number[] = [];

  for (const boundary of boundaries) {
    const train = ordered.filter(
      (row) =>
        row.season < boundary.season ||
        (row.season === boundary.season && row.matchday < boundary.matchday),
    );
    if (train.length < minTrainingRows) continue;

    const test = ordered.filter(
      (row) => row.season === boundary.season && row.matchday === boundary.matchday,
    );
    if (test.length === 0) continue;

    perOrigin.push(evaluateLogLikelihood(fitLambdaModel(train, false), test, false));
  }

  return {
    evaluated: perOrigin.length,
    logLikelihood:
      perOrigin.length === 0
        ? Number.NaN
        : perOrigin.reduce((sum, value) => sum + value, 0) / perOrigin.length,
    perOrigin,
  };
}

export interface EloKCandidate {
  eloK: number;
  movScheme: MovScheme;
  driftWeight: number;
  evaluated: number;
  logLikelihood: number;
  /** Kept so any two candidates can be compared pairwise after the sweep. */
  result: AnchoredWalkForwardResult;
}

export interface SweepOptions {
  eloKs: number[];
  movSchemes: MovScheme[];
  driftWeights?: number[];
  minTrainingRows?: number;
}

/** Scores every (K, scheme, weight) combination on the same walk-forward split. */
export function sweepEloK(
  dataset: HistoricalDataset,
  options: SweepOptions,
): EloKCandidate[] {
  const { eloKs, movSchemes, driftWeights = [1], minTrainingRows = 380 } = options;
  const candidates: EloKCandidate[] = [];

  for (const movScheme of movSchemes) {
    for (const eloK of eloKs) {
      for (const driftWeight of driftWeights) {
        const rows = buildAnchoredRows(dataset, { eloK, movScheme, driftWeight });
        const result = anchoredWalkForward(rows, minTrainingRows);
        candidates.push({
          eloK,
          movScheme,
          driftWeight,
          evaluated: result.evaluated,
          logLikelihood: result.logLikelihood,
          result,
        });
      }
    }
  }

  return candidates.sort((a, b) => b.logLikelihood - a.logLikelihood);
}

/**
 * The two reference points a swept candidate has to be read against.
 *
 * `liveClubelo` is what the engine had before the feed went dark — a base refreshed on the
 * match date, no drift. `frozenNoDrift` is the anchor left to go stale, which is what running
 * with `--no-ratings` and drift off amounts to. A useful K sits between them.
 */
export function referenceBaselines(
  dataset: HistoricalDataset,
  minTrainingRows = 380,
): { liveClubelo: AnchoredWalkForwardResult; frozenNoDrift: AnchoredWalkForwardResult } {
  return {
    liveClubelo: anchoredWalkForward(
      buildAnchoredRows(dataset, { freezeAnchor: false, driftWeight: 0 }),
      minTrainingRows,
    ),
    frozenNoDrift: anchoredWalkForward(
      buildAnchoredRows(dataset, { driftWeight: 0 }),
      minTrainingRows,
    ),
  };
}
