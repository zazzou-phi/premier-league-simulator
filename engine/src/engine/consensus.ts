export type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

/** How a prediction turns a distribution of simulated results into one scoreline. */
export type ConsensusMode = 'scoreline' | 'outcome' | 'sample' | 'expectedPoints';

export const CONSENSUS_MODES: ConsensusMode[] = [
  'scoreline',
  'outcome',
  'sample',
  'expectedPoints',
];

export const DEFAULT_CONSENSUS_MODE: ConsensusMode = 'outcome';

export function parseConsensusMode(value: unknown): ConsensusMode {
  if (typeof value === 'string') {
    const mode = value.trim().toLowerCase();
    // Compare folded rather than testing membership directly: not every mode name is lowercase.
    const match = CONSENSUS_MODES.find((candidate) => candidate.toLowerCase() === mode);
    if (match) return match;
  }
  return DEFAULT_CONSENSUS_MODE;
}

/**
 * Payoff of the predictor game the `expectedPoints` mode plays against. `exactScore` is what a
 * perfect scoreline pays and `correctResult` what a right result with the wrong scoreline pays.
 * These games award the higher of the two rather than both, which is why the expected value of
 * a pick is `correctResult · P(outcome) + (exactScore − correctResult) · P(scoreline)`.
 */
export interface PredictorPoints {
  exactScore: number;
  correctResult: number;
}

export const DEFAULT_PREDICTOR_POINTS: PredictorPoints = { exactScore: 3, correctResult: 1 };

/** Sanity bound on a payoff value; only the ratio of the two matters, not the scale. */
export const PREDICTOR_POINTS_MAX = 1000;

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
export function chooseRepresentativeScoreline(
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
  points: PredictorPoints = DEFAULT_PREDICTOR_POINTS,
): ExpectedPointsCandidate[] {
  const total = outcomeCounts.homeWin + outcomeCounts.draw + outcomeCounts.awayWin;
  if (total === 0) return [];

  return scorelineRepresentatives(scorelines)
    .map((rep) => ({
      goalsHome: rep.goalsHome,
      goalsAway: rep.goalsAway,
      outcome: rep.outcome,
      n: rep.n,
      expectedPoints: expectedPointsCount(outcomeCounts, rep, points) / total,
    }))
    .sort((a, b) => b.expectedPoints - a.expectedPoints);
}

function expectedPointsCount(
  outcomeCounts: OutcomeCounts,
  rep: ScorelineRepresentative,
  points: PredictorPoints,
): number {
  const exactBonus = points.exactScore - points.correctResult;
  return points.correctResult * outcomeCount(outcomeCounts, rep.outcome) + exactBonus * rep.n;
}

/** The scoreline that maximises expected predictor-game points. See {@link rankExpectedPoints}. */
export function chooseExpectedPointsScoreline(
  outcomeCounts: OutcomeCounts,
  scorelines: ScorelineCount[],
  homeElo: number,
  awayElo: number,
  points: PredictorPoints = DEFAULT_PREDICTOR_POINTS,
): { goalsHome: number; goalsAway: number } | null {
  const reps = scorelineRepresentatives(scorelines);
  if (reps.length === 0) return null;

  const scoreOf = (rep: ScorelineRepresentative): number =>
    expectedPointsCount(outcomeCounts, rep, points);

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

export interface ChooseConsensusInput {
  mode?: ConsensusMode;
  outcomeCounts: OutcomeCounts;
  scorelines: ScorelineCount[];
  homeElo: number;
  awayElo: number;
  /** Result for this fixture from the active sampled season; used by 'sample' mode. */
  savedSample?: { goalsHome: number; goalsAway: number } | null;
  /** Predictor-game payoff; used by 'expectedPoints' mode. */
  points?: PredictorPoints;
}

export function chooseConsensus(
  input: ChooseConsensusInput,
): { goalsHome: number; goalsAway: number } | null {
  const mode = input.mode ?? DEFAULT_CONSENSUS_MODE;

  if (mode === 'sample') return input.savedSample ?? null;
  if (mode === 'scoreline') {
    return chooseRepresentativeScoreline(input.scorelines, input.homeElo, input.awayElo);
  }
  if (mode === 'expectedPoints') {
    return chooseExpectedPointsScoreline(
      input.outcomeCounts,
      input.scorelines,
      input.homeElo,
      input.awayElo,
      input.points,
    );
  }

  const outcome = chooseOutcome(input.outcomeCounts, input.homeElo, input.awayElo);
  if (outcome == null) return null;
  return chooseScoreline(input.scorelines, outcome);
}
