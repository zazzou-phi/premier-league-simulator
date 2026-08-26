/**
 * Rebuilds the whole season's Elo history from results, one point per round.
 *
 * The weekly sync only ever records where ratings stand *now*, so the series is as sparse as
 * the loop was run: a fortnight without a run leaves a fortnight without a point, and a round
 * missed at the time could never be recovered. Under clubelo that was unavoidable — a rating
 * for 12 October could only be captured on 12 October.
 *
 * Recomputing from an anchor removes that constraint. Every past round's rating is derivable
 * from `teams.anchor_elo` and the results, so the series can be rebuilt in full at any time,
 * dated to the round each rating followed rather than to whenever someone ran the loop.
 *
 * Each round is computed cumulatively from the anchors rather than by carrying a running total
 * forward, so the final round is by construction the same number
 * {@link ratingsFromRealResults} produces — the two cannot drift apart.
 */
import type { Repository } from '../db/repository.js';
import { ratingsAfter, realResultsInOrder, type PlayedResult } from './syncRatingsFromResults.js';

export interface BackfillRound {
  matchday: number;
  /** Kickoff date of the last fixture played in this round; the snapshot's key. */
  asOf: string;
  /** Results priced in for the first time by this round. */
  matches: number;
}

export interface BackfillSummary {
  rounds: BackfillRound[];
  /** Rows written, or that would be written on a dry run. */
  snapshots: number;
  dryRun: boolean;
}

export interface BackfillOptions {
  repo: Repository;
  dryRun?: boolean;
  eloK?: number;
}

/** Groups played results by round, in the order they should be applied. */
function byRound(results: PlayedResult[]): Map<number, PlayedResult[]> {
  const rounds = new Map<number, PlayedResult[]>();
  for (const result of results) {
    const list = rounds.get(result.matchday);
    if (list) list.push(result);
    else rounds.set(result.matchday, [result]);
  }
  return rounds;
}

export function backfillEloHistory(options: BackfillOptions): BackfillSummary {
  const { repo, dryRun = false, eloK } = options;

  const results = realResultsInOrder(repo);
  const rounds = byRound(results);
  const teams = repo.getTeams();

  const summary: BackfillRound[] = [];
  let snapshots = 0;

  for (const matchday of [...rounds.keys()].sort((a, b) => a - b)) {
    const played = rounds.get(matchday)!;

    // Everything up to and including this round. Recomputing from the anchor each time is
    // O(rounds x matches) — trivial at 380 — and keeps every point on the same footing as the
    // live rating rather than depending on an accumulator being carried correctly.
    const ratings = ratingsAfter(
      repo,
      results.filter((result) => result.matchday <= matchday),
      eloK,
    );
    const asOf = played.reduce((latest, r) => (r.date > latest ? r.date : latest), played[0]!.date);

    if (!dryRun) {
      repo.recordEloSnapshot(
        asOf,
        teams.map((team) => ({ teamId: team.id, elo: ratings.get(team.id) ?? team.elo })),
      );
    }

    snapshots += teams.length;
    summary.push({ matchday, asOf, matches: played.length });
  }

  return { rounds: summary, snapshots, dryRun };
}
