export type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

/** How a prediction turns a distribution of simulated results into one scoreline. */
export type ConsensusMode = 'scoreline' | 'outcome' | 'sample';

export const CONSENSUS_MODES: ConsensusMode[] = ['scoreline', 'outcome', 'sample'];

export const DEFAULT_CONSENSUS_MODE: ConsensusMode = 'outcome';

export function parseConsensusMode(value: unknown): ConsensusMode {
  if (typeof value === 'string') {
    const mode = value.trim().toLowerCase();
    if ((CONSENSUS_MODES as string[]).includes(mode)) return mode as ConsensusMode;
  }
  return DEFAULT_CONSENSUS_MODE;
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

/** Modal scoreline within each outcome, then the most common of those three. */
export function chooseRepresentativeScoreline(
  scorelines: ScorelineCount[],
  homeElo: number,
  awayElo: number,
): { goalsHome: number; goalsAway: number } | null {
  const reps = (
    [
      bestScorelineRepresentative(scorelines, 'homeWin'),
      bestScorelineRepresentative(scorelines, 'draw'),
      bestScorelineRepresentative(scorelines, 'awayWin'),
    ] as const
  ).filter((r): r is ScorelineRepresentative => r != null);
  if (reps.length === 0) return null;

  const maxCount = Math.max(...reps.map((r) => r.n));
  const tied = reps.filter((r) => r.n === maxCount);

  if (tied.length === 1) {
    return { goalsHome: tied[0]!.goalsHome, goalsAway: tied[0]!.goalsAway };
  }

  const drawRep = tied.find((r) => r.outcome === 'draw');
  if (drawRep) return { goalsHome: drawRep.goalsHome, goalsAway: drawRep.goalsAway };

  const homeRep = tied.find((r) => r.outcome === 'homeWin');
  const awayRep = tied.find((r) => r.outcome === 'awayWin');
  if (homeRep && awayRep) {
    return homeElo >= awayElo
      ? { goalsHome: homeRep.goalsHome, goalsAway: homeRep.goalsAway }
      : { goalsHome: awayRep.goalsHome, goalsAway: awayRep.goalsAway };
  }
  return { goalsHome: tied[0]!.goalsHome, goalsAway: tied[0]!.goalsAway };
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
}

export function chooseConsensus(
  input: ChooseConsensusInput,
): { goalsHome: number; goalsAway: number } | null {
  const mode = input.mode ?? DEFAULT_CONSENSUS_MODE;

  if (mode === 'sample') return input.savedSample ?? null;
  if (mode === 'scoreline') {
    return chooseRepresentativeScoreline(input.scorelines, input.homeElo, input.awayElo);
  }

  const outcome = chooseOutcome(input.outcomeCounts, input.homeElo, input.awayElo);
  if (outcome == null) return null;
  return chooseScoreline(input.scorelines, outcome);
}
