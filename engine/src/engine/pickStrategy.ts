export type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

/**
 * How a prediction turns a distribution of simulated results into the one scoreline it picks
 * for a fixture.
 *
 * `likeliestScore`, `likeliestResult` and `maxPoints` are per-fixture rules: each fixture is
 * decided from its own histogram alone. `random` and `calibrated` are season-wide — the caller
 * resolves the whole season first and passes this function the answer for one fixture.
 */
export type PickStrategy =
  | 'likeliestScore'
  | 'likeliestResult'
  | 'maxPoints'
  | 'random'
  | 'calibrated';

export const PICK_STRATEGIES: PickStrategy[] = [
  'likeliestScore',
  'likeliestResult',
  'maxPoints',
  'random',
  'calibrated',
];

export const DEFAULT_PICK_STRATEGY: PickStrategy = 'calibrated';

/** Legacy stored values, kept parseable so old rows and old API clients still resolve. */
const LEGACY_STRATEGY_NAMES: Record<string, PickStrategy> = {
  scoreline: 'likeliestScore',
  outcome: 'likeliestResult',
  expectedpoints: 'maxPoints',
  sample: 'random',
};

export function parsePickStrategy(value: unknown): PickStrategy {
  if (typeof value === 'string') {
    const name = value.trim().toLowerCase();
    // Compare folded rather than testing membership directly: not every name is lowercase.
    const match = PICK_STRATEGIES.find((candidate) => candidate.toLowerCase() === name);
    if (match) return match;
    const legacy = LEGACY_STRATEGY_NAMES[name];
    if (legacy) return legacy;
  }
  return DEFAULT_PICK_STRATEGY;
}

/**
 * Payoff of the predictor game the `maxPoints` strategy plays against. `exactScore` is what a
 * perfect scoreline pays and `correctResult` what a right result with the wrong scoreline pays.
 * These games award the higher of the two rather than both, which is why the expected value of
 * a pick is `correctResult · P(outcome) + (exactScore − correctResult) · P(scoreline)`.
 */
export interface ScoringRules {
  exactScore: number;
  correctResult: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = { exactScore: 3, correctResult: 1 };

/** Sanity bound on a payoff value; only the ratio of the two matters, not the scale. */
export const SCORING_POINTS_MAX = 1000;

export interface OutcomeCounts {
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface ScorelineCount {
  goalsHome: number;
  goalsAway: number;
  n: number;
}

export function outcomeFromScoreline(
  s: Pick<ScorelineCount, 'goalsHome' | 'goalsAway'>,
): MatchOutcome {
  if (s.goalsHome > s.goalsAway) return 'homeWin';
  if (s.goalsAway > s.goalsHome) return 'awayWin';
  return 'draw';
}

/** Most frequent outcome. A win beats a draw on ties; two tied wins go to the higher Elo. */
export function chooseOutcome(
  counts: OutcomeCounts,
  homeElo: number,
  awayElo: number,
): MatchOutcome | null {
  const total = counts.homeWin + counts.draw + counts.awayWin;
  if (total === 0) return null;

  const maxCount = Math.max(counts.homeWin, counts.draw, counts.awayWin);
  let tied: MatchOutcome[] = (
    [
      ['homeWin', counts.homeWin],
      ['draw', counts.draw],
      ['awayWin', counts.awayWin],
    ] as const
  )
    .filter(([, count]) => count === maxCount)
    .map(([outcome]) => outcome);

  if (tied.some((o) => o !== 'draw') && tied.includes('draw')) {
    tied = tied.filter((o) => o !== 'draw');
  }
  if (tied.length === 1) return tied[0]!;

  if (tied.includes('homeWin') && tied.includes('awayWin')) {
    return homeElo >= awayElo ? 'homeWin' : 'awayWin';
  }
  return tied[0]!;
}

function sortScorelinesByFrequency(scorelines: ScorelineCount[]): ScorelineCount[] {
  return [...scorelines].sort((a, b) => {
    if (b.n !== a.n) return b.n - a.n;
    return b.goalsHome + b.goalsAway - (a.goalsHome + a.goalsAway);
  });
}

/** Most frequent scoreline that produces the given outcome. */
export function chooseScoreline(
  scorelines: ScorelineCount[],
  outcome: MatchOutcome,
): { goalsHome: number; goalsAway: number } | null {
  const matching = scorelines.filter((s) => outcomeFromScoreline(s) === outcome);
  if (matching.length === 0) return null;
  const best = sortScorelinesByFrequency(matching)[0]!;
  return { goalsHome: best.goalsHome, goalsAway: best.goalsAway };
}

type ScorelineRepresentative = ScorelineCount & { outcome: MatchOutcome };

function bestScorelineRepresentative(
  scorelines: ScorelineCount[],
  outcome: MatchOutcome,
): ScorelineRepresentative | null {
  const matching = scorelines.filter((s) => outcomeFromScoreline(s) === outcome);
  if (matching.length === 0) return null;
  return { ...sortScorelinesByFrequency(matching)[0]!, outcome };
}

/**
 * The one candidate per outcome worth considering: three scorelines, at most. Ordered
 * homeWin, draw, awayWin; outcomes no run produced are dropped.
 */
function scorelineRepresentatives(scorelines: ScorelineCount[]): ScorelineRepresentative[] {
  return (
    [
      bestScorelineRepresentative(scorelines, 'homeWin'),
      bestScorelineRepresentative(scorelines, 'draw'),
      bestScorelineRepresentative(scorelines, 'awayWin'),
    ] as const
  ).filter((r): r is ScorelineRepresentative => r != null);
}

/** A draw beats a win on ties; two tied wins go to the higher Elo. */
function breakRepresentativeTie(
  tied: ScorelineRepresentative[],
  homeElo: number,
  awayElo: number,
): ScorelineRepresentative {
  if (tied.length === 1) return tied[0]!;

  const drawRep = tied.find((r) => r.outcome === 'draw');
  if (drawRep) return drawRep;

  const homeRep = tied.find((r) => r.outcome === 'homeWin');
  const awayRep = tied.find((r) => r.outcome === 'awayWin');
  if (homeRep && awayRep) return homeElo >= awayElo ? homeRep : awayRep;

  return tied[0]!;
}

/** Modal scoreline within each outcome, then the most common of those three. */
export function chooseLikeliestScore(
  scorelines: ScorelineCount[],
  homeElo: number,
  awayElo: number,
): { goalsHome: number; goalsAway: number } | null {
  const reps = scorelineRepresentatives(scorelines);
  if (reps.length === 0) return null;

  const maxCount = Math.max(...reps.map((r) => r.n));
  const best = breakRepresentativeTie(
    reps.filter((r) => r.n === maxCount),
    homeElo,
    awayElo,
  );
  return { goalsHome: best.goalsHome, goalsAway: best.goalsAway };
}

function outcomeCount(counts: OutcomeCounts, outcome: MatchOutcome): number {
  if (outcome === 'homeWin') return counts.homeWin;
  if (outcome === 'awayWin') return counts.awayWin;
  return counts.draw;
}

export interface ExpectedPointsCandidate {
  goalsHome: number;
  goalsAway: number;
  outcome: MatchOutcome;
  /** Runs in which this exact scoreline came up. */
  n: number;
  /** Expected predictor-game points from picking it, per fixture. */
  expectedPoints: number;
}

/**
 * Score every candidate pick by expected predictor-game points, best first.
 *
 * Only three candidates can win. Within one outcome the `P(outcome)` term is constant, so the
 * best pick there is that outcome's modal scoreline; and a scoreline no run produced scores
 * `P(scoreline) = 0`, which cannot beat the modal scoreline sharing its outcome. Restricting
 * the search to `scorelineRepresentatives` is therefore exact, not an approximation.
 *
 * Ranked on raw run counts — same order, no float division — with `expectedPoints` normalised
 * afterwards for display.
 */
export function rankExpectedPoints(
  outcomeCounts: OutcomeCounts,
  scorelines: ScorelineCount[],
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): ExpectedPointsCandidate[] {
  const total = outcomeCounts.homeWin + outcomeCounts.draw + outcomeCounts.awayWin;
  if (total === 0) return [];

  return scorelineRepresentatives(scorelines)
    .map((rep) => ({
      goalsHome: rep.goalsHome,
      goalsAway: rep.goalsAway,
      outcome: rep.outcome,
      n: rep.n,
      expectedPoints: expectedPointsCount(outcomeCounts, rep, rules) / total,
    }))
    .sort((a, b) => b.expectedPoints - a.expectedPoints);
}

function expectedPointsCount(
  outcomeCounts: OutcomeCounts,
  rep: ScorelineRepresentative,
  rules: ScoringRules,
): number {
  const exactBonus = rules.exactScore - rules.correctResult;
  return rules.correctResult * outcomeCount(outcomeCounts, rep.outcome) + exactBonus * rep.n;
}

/** The scoreline that maximises expected predictor-game points. See {@link rankExpectedPoints}. */
export function chooseMaxPointsScore(
  outcomeCounts: OutcomeCounts,
  scorelines: ScorelineCount[],
  homeElo: number,
  awayElo: number,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): { goalsHome: number; goalsAway: number } | null {
  const reps = scorelineRepresentatives(scorelines);
  if (reps.length === 0) return null;

  const scoreOf = (rep: ScorelineRepresentative): number =>
    expectedPointsCount(outcomeCounts, rep, rules);

  const maxScore = Math.max(...reps.map(scoreOf));
  const best = breakRepresentativeTie(
    reps.filter((r) => scoreOf(r) === maxScore),
    homeElo,
    awayElo,
  );
  return { goalsHome: best.goalsHome, goalsAway: best.goalsAway };
}

export function computeMeanExpectedGoals(
  scorelines: ScorelineCount[],
): { goalsHome: number; goalsAway: number } | null {
  if (scorelines.length === 0) return null;

  let total = 0;
  let sumHome = 0;
  let sumAway = 0;
  for (const s of scorelines) {
    total += s.n;
    sumHome += s.goalsHome * s.n;
    sumAway += s.goalsAway * s.n;
  }
  if (total === 0) return null;

  return { goalsHome: sumHome / total, goalsAway: sumAway / total };
}

export interface ChoosePickInput {
  strategy?: PickStrategy;
  outcomeCounts: OutcomeCounts;
  scorelines: ScorelineCount[];
  homeElo: number;
  awayElo: number;
  /** Result for this fixture from the active sampled season; used by `random`. */
  savedSample?: { goalsHome: number; goalsAway: number } | null;
  /**
   * This fixture's share of the season-wide calibrated assignment; used by `calibrated`.
   * Built by `buildCalibratedPicks`, which needs every fixture at once.
   */
  calibratedPick?: { goalsHome: number; goalsAway: number } | null;
  /** Predictor-game payoff; used by `maxPoints`. */
  rules?: ScoringRules;
}

export function choosePick(
  input: ChoosePickInput,
): { goalsHome: number; goalsAway: number } | null {
  const strategy = input.strategy ?? DEFAULT_PICK_STRATEGY;

  if (strategy === 'random') return input.savedSample ?? null;
  if (strategy === 'calibrated') return input.calibratedPick ?? null;
  if (strategy === 'likeliestScore') {
    return chooseLikeliestScore(input.scorelines, input.homeElo, input.awayElo);
  }
  if (strategy === 'maxPoints') {
    return chooseMaxPointsScore(
      input.outcomeCounts,
      input.scorelines,
      input.homeElo,
      input.awayElo,
      input.rules,
    );
  }

  const outcome = chooseOutcome(input.outcomeCounts, input.homeElo, input.awayElo);
  if (outcome == null) return null;
  return chooseScoreline(input.scorelines, outcome);
}
