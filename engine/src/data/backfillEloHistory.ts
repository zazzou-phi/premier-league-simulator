/**
 * Rebuilds the whole season's Elo history from results, one point per day football was played.
 *
 * The weekly sync only ever records where ratings stand *now*, so the series is as sparse as
 * the loop was run: a fortnight without a run leaves a fortnight without a point, and a day
 * missed at the time could never be recovered. Under clubelo that was unavoidable — a rating
 * for 12 October could only be captured on 12 October.
 *
 * Recomputing from an anchor removes that constraint. Every past rating is derivable from
 * `teams.anchor_elo` and the results, so the series can be rebuilt in full at any time.
 *
 * Points are grouped by **date, not by round**, which follows from replaying results in
 * chronological order (see {@link realResultsInOrder}). Grouping by round while accumulating by
 * date would produce incoherent labels: a round with a fixture postponed to December closes in
 * December, so "round 3" would name a snapshot containing every result up to that point,
 * rounds 4 through 16 included. A date names exactly what it contains.
 *
 * Each point is computed cumulatively from the anchors rather than by carrying a running total
 * forward, so the last one is by construction the same number {@link ratingsFromRealResults}
 * produces — the two cannot drift apart.
 */
import type { Repository } from '../db/repository.js';
import { ratingsAfter, realResultsInOrder, type PlayedResult } from './syncRatingsFromResults.js';

export interface BackfillPoint {
  /** The day these results were played; the snapshot's key. */
  asOf: string;
  /** Results priced in for the first time on this day. */
  matches: number;
  /** Rounds those results belong to — usually one, more when a rearranged match lands here. */
  matchdays: number[];
}

export interface BackfillSummary {
  points: BackfillPoint[];
  /** Distinct rows stored, or that would be stored on a dry run. */
  snapshots: number;
  /** Snapshot dates removed because no result falls on them any more. */
  pruned: number;
  dryRun: boolean;
}

export interface BackfillOptions {
  repo: Repository;
  dryRun?: boolean;
  eloK?: number;
  /**
   * Remove snapshot dates no result falls on any more.
   *
   * A rescheduled fixture moves to a new date and the rebuild writes it there — but the row
   * under the old date would linger as a rating for a day nothing was played. Pruning is
   * floored at the season's earliest played fixture, so the pre-season baseline `seed` writes
   * is never touched.
   */
  prune?: boolean;
}

/** Groups played results by the day they were played, preserving chronological order. */
function byDate(results: PlayedResult[]): Map<string, PlayedResult[]> {
  const days = new Map<string, PlayedResult[]>();
  for (const result of results) {
    const list = days.get(result.date);
    if (list) list.push(result);
    else days.set(result.date, [result]);
  }
  return days;
}

/** The day before `date`, as `YYYY-MM-DD`. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function backfillEloHistory(options: BackfillOptions): BackfillSummary {
  const { repo, dryRun = false, eloK, prune = false } = options;

  const results = realResultsInOrder(repo);
  const days = byDate(results);
  const teams = repo.getTeams();
  const anchors = new Map(teams.map((team) => [team.id, team.anchorElo ?? team.elo]));

  const points: BackfillPoint[] = [];

  // Open the series on the anchors, the day before the first result. `seed` writes a baseline
  // too, but it cannot be told apart from a stale point by date alone — both are days no result
  // falls on — so the rebuild derives its own rather than guessing which to spare. Deriving it
  // also means the series always starts from the rating everything else is recomputed from.
  if (results.length > 0) {
    const opening = dayBefore([...days.keys()].sort()[0]!);
    if (!dryRun) {
      repo.recordEloSnapshot(
        opening,
        teams.map((team) => ({ teamId: team.id, elo: anchors.get(team.id)! })),
      );
    }
    points.push({ asOf: opening, matches: 0, matchdays: [] });
  }

  for (const asOf of [...days.keys()].sort()) {
    const played = days.get(asOf)!;

    // Everything played on or before this day. Recomputing from the anchor each time is
    // O(days x matches) — trivial at 380 — and keeps every point on the same footing as the
    // live rating rather than depending on an accumulator being carried correctly.
    const ratings = ratingsAfter(
      repo,
      results.filter((result) => result.date <= asOf),
      eloK,
    );

    if (!dryRun) {
      repo.recordEloSnapshot(
        asOf,
        teams.map((team) => ({ teamId: team.id, elo: ratings.get(team.id) ?? team.elo })),
      );
    }

    points.push({
      asOf,
      matches: played.length,
      matchdays: [...new Set(played.map((r) => r.matchday))].sort((a, b) => a - b),
    });
  }

  let pruned = 0;
  if (prune && !dryRun && points.length > 0) {
    // Every date the rebuild just wrote, and nothing else. The opening anchor point is among
    // them, so there is no baseline to spare and no date-based guess to get wrong.
    pruned = repo.pruneEloSnapshots(points.map((point) => point.asOf));
  }

  return { points, snapshots: points.length * teams.length, pruned, dryRun };
}
