export type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

/**
 * How a prediction turns a distribution of simulated results into the one scoreline it picks
 * for a fixture.
 *
 * Every strategy is season-wide: the caller resolves the whole season first and passes this
 * function the answer for one fixture. The per-fixture rules that used to sit alongside them
 * were withdrawn — deciding each fixture from its own histogram cannot help but distort the
 * season's W/D/L, since the mode of a marginal is not a draw from it.
 */
export type PickStrategy = 'plausible' | 'calibrated' | 'random';

/** Display order as well as the set of valid values: the default leads. */
export const PICK_STRATEGIES: PickStrategy[] = ['plausible', 'calibrated', 'random'];

export const DEFAULT_PICK_STRATEGY: PickStrategy = 'plausible';

/** Legacy stored values, kept parseable so old rows and old API clients still resolve. */
const LEGACY_STRATEGY_NAMES: Record<string, PickStrategy> = {
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

export interface ScorelineCandidate extends ScorelineCount {
  outcome: MatchOutcome;
}

/**
 * The one candidate scoreline per outcome, most frequent first.
 *
 * Three at most, since within an outcome only its modal scoreline can be the one worth showing;
 * outcomes no run produced are dropped. This is what the per-fixture distribution view labels
 * each outcome bar with, and its first entry is the fixture's likeliest scoreline outright.
 */
export function rankScorelineCandidates(scorelines: ScorelineCount[]): ScorelineCandidate[] {
  return scorelineRepresentatives(scorelines).sort((a, b) => {
    if (b.n !== a.n) return b.n - a.n;
    return b.goalsHome + b.goalsAway - (a.goalsHome + a.goalsAway);
  });
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
  /** Result for this fixture from the active sampled season; used by `random`. */
  savedSample?: { goalsHome: number; goalsAway: number } | null;
  /**
   * This fixture's share of a season-wide assignment; used by `calibrated` and `plausible`.
   * Both are solved by `buildCalibratedPicks`, which needs every fixture at once, and differ
   * only in the draw targets they aim at.
   */
  seasonPick?: { goalsHome: number; goalsAway: number } | null;
}

/**
 * One fixture's scoreline under the chosen strategy.
 *
 * Every strategy is now season-wide, so this is a lookup rather than a decision: the caller
 * resolves the whole season and this hands back that season's answer for one fixture. It stays
 * as the seam because the two sources are resolved differently and callers should not have to
 * know which applies.
 */
export function choosePick(
  input: ChoosePickInput,
): { goalsHome: number; goalsAway: number } | null {
  const strategy = input.strategy ?? DEFAULT_PICK_STRATEGY;
  return (strategy === 'random' ? input.savedSample : input.seasonPick) ?? null;
}
