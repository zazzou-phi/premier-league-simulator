import {
  chooseScoreline,
  type MatchOutcome,
  type OutcomeCounts,
  type ScorelineCount,
} from './pickStrategy.js';

/**
 * Season-wide calibrated picks.
 *
 * Every per-fixture rule picks the *mode* of a distribution, and the mode of a marginal is not
 * a draw from it. A draw is almost never the single likeliest outcome (~22% against ~44% home),
 * so `likeliestResult` returns literally zero draws across a season; conversely draw mass piles
 * onto 1–1 and 0–0 while win mass spreads over 1–0, 2–0, 2–1, so `likeliestScore` returns a draw
 * for most fixtures. Same distribution, opposite failure.
 *
 * This strategy instead picks the whole season at once: the assignment that maximises total
 * log-likelihood *subject to* the counts matching what the simulation itself expects — the
 * league's home/draw/away split, and each team's own expected number of draws.
 *
 * That constrained optimum is reached by adding a bias to each outcome's log-probability and
 * tuning the biases until the counts land on target (the Lagrangian dual). One bias per team
 * for draws, one shared bias for away wins; home win is the reference and carries none.
 */

export interface CalibratedFixture {
  matchNumber: number;
  teamHomeId: number;
  teamAwayId: number;
  outcomeCounts: OutcomeCounts;
  scorelines: ScorelineCount[];
}

/**
 * `buildCalibratedPicks` over the shape callers already hold: a fixture list plus the batch's
 * distributions, keyed by match number. Fixtures the batch has no distribution for are skipped.
 */
export function calibratedPicksFor(
  fixtures: Array<{ matchNumber: number; teamHomeId: number; teamAwayId: number }>,
  distributions: Map<number, { outcomes: OutcomeCounts; scorelines: ScorelineCount[] }>,
  options: CalibratedPickOptions = {},
): Map<number, { goalsHome: number; goalsAway: number }> {
  return buildCalibratedPicks(
    fixtures.flatMap((fixture) => {
      const distribution = distributions.get(fixture.matchNumber);
      if (!distribution) return [];
      return [
        {
          matchNumber: fixture.matchNumber,
          teamHomeId: fixture.teamHomeId,
          teamAwayId: fixture.teamAwayId,
          outcomeCounts: distribution.outcomes,
          scorelines: distribution.scorelines,
        },
      ];
    }),
    options,
  );
}


/** A fixture list paired with the batch's distributions, as every caller here holds them. */
type FixtureRef = { matchNumber: number; teamHomeId: number; teamAwayId: number };
type Distributions = Map<number, { outcomes: OutcomeCounts; scorelines: ScorelineCount[] }>;
/** One simulated season from the batch's reservoir, keyed by match number. */
export type SampledSeason = ReadonlyMap<number, { goalsHome: number; goalsAway: number }>;

/** How many draws each club takes in one sampled season. */
export function drawTargetsFromSeason(
  fixtures: FixtureRef[],
  season: SampledSeason,
): Map<number, number> {
  const targets = new Map<number, number>();
  const bump = (teamId: number, by: number) =>
    targets.set(teamId, (targets.get(teamId) ?? 0) + by);

  for (const fixture of fixtures) {
    bump(fixture.teamHomeId, 0);
    bump(fixture.teamAwayId, 0);
    const result = season.get(fixture.matchNumber);
    if (result && result.goalsHome === result.goalsAway) {
      bump(fixture.teamHomeId, 1);
      bump(fixture.teamAwayId, 1);
    }
  }
  return targets;
}

/** Draws the batch expects across the whole fixture list. */
function expectedLeagueDraws(fixtures: FixtureRef[], distributions: Distributions): number {
  let total = 0;
  for (const fixture of fixtures) {
    const counts = distributions.get(fixture.matchNumber)?.outcomes;
    if (!counts) continue;
    const runs = counts.homeWin + counts.draw + counts.awayWin;
    if (runs > 0) total += counts.draw / runs;
  }
  return total;
}

/**
 * The calibrated solve aimed at a season that could actually happen.
 *
 * `calibratedPicksFor` targets each club's *mean* draws, which no single season ever matches:
 * the table it emits spreads clubs over about a third of the range a real one does, because a
 * mean has no variance in it. This aims the same solve at one of the seasons in the batch's
 * reservoir instead — real draw counts, with real spread.
 *
 * Which season is decided on league total alone: the one whose draws come closest to what the
 * batch expects, ties going to the earliest sample. Reservoir order is stable and the
 * comparison is strict, so the strategy is deterministic given the batch. It keeps the
 * league-level calibration its sibling guarantees and relaxes the per-club distribution around
 * it, which is the only part that was ever too even.
 *
 * The candidates are the sampled seasons alone. Including the mean-targeted solve would let the
 * strategy quietly collapse back into `calibrated` on batches where no sample beat it, which is
 * the one thing a caller choosing this strategy has ruled out. With no reservoir to draw on
 * there is nothing to be plausible about, and it falls back to the mean.
 */
export function plausiblePicksFor(
  fixtures: FixtureRef[],
  distributions: Distributions,
  sampledSeasons: readonly SampledSeason[],
): Map<number, { goalsHome: number; goalsAway: number }> {
  if (sampledSeasons.length === 0) return calibratedPicksFor(fixtures, distributions);

  const expected = expectedLeagueDraws(fixtures, distributions);
  let chosen: Map<number, number> | null = null;
  let closest = Number.POSITIVE_INFINITY;

  for (const season of sampledSeasons) {
    const drawTargets = drawTargetsFromSeason(fixtures, season);
    // Each draw is counted by both its clubs, so the vector sums to twice the league total.
    let doubled = 0;
    for (const target of drawTargets.values()) doubled += target;

    const levelError = Math.abs(doubled / 2 - expected);
    if (levelError < closest) {
      closest = levelError;
      chosen = drawTargets;
    }
  }

  return chosen
    ? calibratedPicksFor(fixtures, distributions, { drawTargets: chosen })
    : calibratedPicksFor(fixtures, distributions);
}

/** Stands in for log 0. Finite so it survives being added to a bias. */
const LOG_FLOOR = -1e6;

/**
 * Safety stop, not a budget: a full 380-fixture season settles in around 100 sweeps, and each is
 * well under a millisecond. Convergence is not proven, so the cap bounds a possible cycle — and
 * stopping early still yields a valid assignment, just one sitting off its targets.
 */
const MAX_SWEEPS = 500;

const CONVERGED = 1e-9;

interface Slot {
  matchNumber: number;
  home: number;
  away: number;
  logHome: number;
  logDraw: number;
  logAway: number;
  pDraw: number;
  pAway: number;
  drawPossible: boolean;
  awayPossible: boolean;
  scorelines: ScorelineCount[];
}

const ln = (p: number): number => (p > 0 ? Math.log(p) : LOG_FLOOR);

/**
 * Round fractional targets to integers that still sum to `total`, giving the spare units to
 * the largest fractional parts. Keeps the per-team draw targets summing to the league total.
 */
function largestRemainder(values: number[], total: number): number[] {
  const floors = values.map((value) => Math.floor(value));
  let spare = total - floors.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of order) {
    if (spare <= 0) break;
    floors[index]! += 1;
    spare -= 1;
  }
  return floors;
}

/**
 * The bias that makes exactly `wanted` of these thresholds fire, where a threshold fires when
 * it is at or below the bias. Sits midway between the two straddling thresholds so repeated
 * sweeps land on the same value instead of creeping.
 */
function biasForCount(sorted: number[], wanted: number): number {
  const k = Math.max(0, Math.min(wanted, sorted.length));
  if (sorted.length === 0) return 0;
  if (k === 0) return sorted[0]! - 1;
  if (k === sorted.length) return sorted[k - 1]! + 1;
  return (sorted[k - 1]! + sorted[k]!) / 2;
}

function outcomeOf(slot: Slot, drawBias: number, awayBias: number): MatchOutcome {
  const draw = slot.drawPossible ? slot.logDraw + drawBias : LOG_FLOOR;
  const home = slot.logHome;
  const away = slot.awayPossible ? slot.logAway + awayBias : LOG_FLOOR;

  // Ties go draw, then home — matching the threshold comparisons used to solve for the biases.
  if (draw >= home && draw >= away) return 'draw';
  return home >= away ? 'homeWin' : 'awayWin';
}

export interface CalibratedPickOptions {
  /**
   * Per-team draw targets replacing the expectations read off the distributions.
   *
   * The default targets are each team's *mean* draws, so the picked table is under-dispersed:
   * every club lands within a draw or two of the league average, where a real season spreads
   * them over roughly three times that range. Passing a target vector sampled from the batch
   * instead — one simulated season's per-team draw counts — keeps the solve exactly as it is
   * but aims it at a plausible season rather than the average of all of them.
   */
  drawTargets?: ReadonlyMap<number, number>;
}

/**
 * Pick one scoreline per fixture so the season's outcome counts match the simulation's own
 * expectations. Deterministic given its targets: no randomness, and every sort is total.
 */
export function buildCalibratedPicks(
  fixtures: CalibratedFixture[],
  options: CalibratedPickOptions = {},
): Map<number, { goalsHome: number; goalsAway: number }> {
  const slots: Slot[] = [];

  for (const fixture of fixtures) {
    const counts = fixture.outcomeCounts;
    const total = counts.homeWin + counts.draw + counts.awayWin;
    if (total === 0) continue;

    slots.push({
      matchNumber: fixture.matchNumber,
      home: fixture.teamHomeId,
      away: fixture.teamAwayId,
      logHome: ln(counts.homeWin / total),
      logDraw: ln(counts.draw / total),
      logAway: ln(counts.awayWin / total),
      pDraw: counts.draw / total,
      pAway: counts.awayWin / total,
      drawPossible: counts.draw > 0,
      awayPossible: counts.awayWin > 0,
      scorelines: fixture.scorelines,
    });
  }
  if (slots.length === 0) return new Map();

  slots.sort((a, b) => a.matchNumber - b.matchNumber);

  // Targets, straight from the distributions the batch produced.
  const teamIds = [...new Set(slots.flatMap((slot) => [slot.home, slot.away]))].sort(
    (a, b) => a - b,
  );
  const expectedDraws = new Map(teamIds.map((id) => [id, 0]));
  let expectedAwayWins = 0;

  for (const slot of slots) {
    expectedDraws.set(slot.home, expectedDraws.get(slot.home)! + slot.pDraw);
    expectedDraws.set(slot.away, expectedDraws.get(slot.away)! + slot.pDraw);
    expectedAwayWins += slot.pAway;
  }

  // Each draw is counted by both its teams, so the per-team targets must sum to an even number.
  const expectedByTeam = teamIds.map((id) => options.drawTargets?.get(id) ?? expectedDraws.get(id)!);
  const drawSlots = 2 * Math.round(expectedByTeam.reduce((sum, value) => sum + value, 0) / 2);
  const rounded = largestRemainder(expectedByTeam, drawSlots);
  const drawTargets = new Map(teamIds.map((id, index) => [id, rounded[index]!]));
  const awayTarget = Math.round(expectedAwayWins);

  const slotsByTeam = new Map<number, Slot[]>(teamIds.map((id) => [id, []]));
  for (const slot of slots) {
    slotsByTeam.get(slot.home)!.push(slot);
    slotsByTeam.get(slot.away)!.push(slot);
  }

  const drawBias = new Map<number, number>(teamIds.map((id) => [id, 0]));
  let awayBias = 0;

  const biasOf = (slot: Slot): number => drawBias.get(slot.home)! + drawBias.get(slot.away)!;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let moved = 0;

    for (const teamId of teamIds) {
      const own = slotsByTeam.get(teamId)!;
      const other = (slot: Slot) => (slot.home === teamId ? slot.away : slot.home);

      // A draw needs `logDraw + β_team + β_opponent >= max(logHome, logAway + awayBias)`, so
      // for this team the fixture becomes a draw exactly once β_team clears this threshold.
      const thresholds = own
        .filter((slot) => slot.drawPossible)
        .map((slot) => {
          const rival = Math.max(
            slot.logHome,
            slot.awayPossible ? slot.logAway + awayBias : LOG_FLOOR,
          );
          return rival - slot.logDraw - drawBias.get(other(slot))!;
        })
        .sort((a, b) => a - b);

      const next = biasForCount(thresholds, drawTargets.get(teamId)!);
      moved = Math.max(moved, Math.abs(next - drawBias.get(teamId)!));
      drawBias.set(teamId, next);
    }

    // Away wins take ties from neither side, so this threshold is cleared strictly; the
    // midpoint `biasForCount` returns satisfies both readings.
    const awayThresholds = slots
      .filter((slot) => slot.awayPossible)
      .map((slot) => {
        const rival = Math.max(
          slot.logHome,
          slot.drawPossible ? slot.logDraw + biasOf(slot) : LOG_FLOOR,
        );
        return rival - slot.logAway;
      })
      .sort((a, b) => a - b);

    const nextAway = biasForCount(awayThresholds, awayTarget);
    moved = Math.max(moved, Math.abs(nextAway - awayBias));
    awayBias = nextAway;

    if (moved < CONVERGED) break;
  }

  const picks = new Map<number, { goalsHome: number; goalsAway: number }>();
  for (const slot of slots) {
    const outcome = outcomeOf(slot, biasOf(slot), awayBias);
    const scoreline =
      chooseScoreline(slot.scorelines, outcome) ??
      chooseScoreline(slot.scorelines, 'homeWin') ??
      chooseScoreline(slot.scorelines, 'draw') ??
      chooseScoreline(slot.scorelines, 'awayWin');
    if (scoreline) picks.set(slot.matchNumber, scoreline);
  }
  return picks;
}
