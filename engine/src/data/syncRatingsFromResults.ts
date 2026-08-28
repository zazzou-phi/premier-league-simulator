/**
 * Recomputes each club's rating from real results, replacing the weekly clubelo refresh.
 *
 * `api.clubelo.com` stopped answering on 22 August 2026 and published no replacement feed, so
 * the base rating had no source. This is the source now: the engine's own Elo update, fed the
 * scorelines it already has.
 *
 * Two rules keep it honest.
 *
 * **Recompute, never increment.** Every run rebuilds the rating from `teams.anchor_elo` — the
 * last rating that came from outside the model — plus the drift implied by *all* real results
 * to date. Running it twice in a row is a no-op, and a corrected scoreline is absorbed rather
 * than layered on top of the wrong one. Incrementing from the current rating would compound
 * instead, which is the one failure mode worth designing against.
 *
 * **`teams.csv` holds the pre-season rating, and is never rewritten.** It is the anchor set,
 * which is what makes a rebuilt database reproduce the season rather than restart it: seed it,
 * replay the results, and every rating on every date falls out. Writing the drifted rating
 * back would destroy the only copy of what it drifted *from* — the next sync would then anchor
 * on the drifted number and price every result in twice. The live rating lives in the database,
 * derived; `team_elo_history` caches the dated series `backfillEloHistory` can rebuild.
 *
 * **The simulator must not drift on these results again.** Once a result is in the base, the
 * remainder-only run has to treat it as already priced in — exactly as it did when clubelo
 * owned the base. `SeasonRunner` and `runMonteCarlo` therefore drift only on matches they
 * simulated themselves. Moving that boundary in either direction double-counts.
 */
import { computeEloDeltasFromMatches, type EloMatchInput } from '../engine/seasonElo.js';
import type { Repository } from '../db/repository.js';
import { computeEloMoves, type SyncRatingsSummary } from './fetchRatings.js';

export interface SyncRatingsFromResultsOptions {
  repo: Repository;
  dryRun?: boolean;
  /** Reporting date when there is nothing to snapshot; defaults to today. */
  date?: Date;
  eloK?: number;
}

/**
 * Kickoff date of the latest real result priced into the rating, or null if none is.
 *
 * This dates the history snapshot, rather than the day the sync happened to run. A rating only
 * moves when a match is played, so keying the snapshot to the clock records the same number
 * again on every idle run: three runs in a quiet week wrote three identical rows, and a series
 * of identical values makes the last real move unreadable — `groupEloSeries` reports the delta
 * between the final two snapshots, which is zero once a flat one lands on top.
 *
 * Deriving the key from the results instead makes a repeat run collapse onto the row it already
 * wrote, and gives the series an x-axis that means "after the round played on this date".
 */
export function lastResultDate(repo: Repository): string | null {
  const fixtures = new Map(repo.getFixtures().map((fixture) => [fixture.matchNumber, fixture]));
  let latest: string | null = null;
  for (const matchNumber of repo.getActualResultsByMatch().keys()) {
    const date = fixtures.get(matchNumber)?.date;
    if (date != null && (latest == null || date > latest)) latest = date;
  }
  return latest;
}

/** A real result with the round and kickoff it was played at, for replaying in order. */
export interface PlayedResult extends EloMatchInput {
  matchday: number;
  date: string;
  time: string;
}

/**
 * Every real result, in the order a replay should apply them: **chronological**.
 *
 * Elo is a sequential process, so the order decides the numbers — each update is sized by how
 * surprising the result was against the ratings standing at that moment. Ordering by round
 * instead would replay a match postponed to December among its original September neighbours,
 * carrying a club's September form into a match it played three months later.
 *
 * With no rearrangements the two orders are identical, since rounds run in date order. They
 * only diverge for a fixture that actually moved, which is exactly the case worth getting
 * right. Kickoff time then match number break ties within a day, so the sequence is
 * deterministic regardless of the order results were recorded in.
 */
export function realResultsInOrder(repo: Repository): PlayedResult[] {
  const fixtures = new Map(repo.getFixtures().map((fixture) => [fixture.matchNumber, fixture]));
  return [...repo.getActualResultsByMatch().entries()]
    .flatMap(([matchNumber, result]) => {
      const fixture = fixtures.get(matchNumber);
      if (!fixture) return [];
      return [
        {
          matchNumber,
          teamHomeId: fixture.teamHomeId,
          teamAwayId: fixture.teamAwayId,
          goalsHome: result.goalsHome,
          goalsAway: result.goalsAway,
          matchday: fixture.matchday,
          date: fixture.date,
          time: fixture.time,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.time.localeCompare(b.time) ||
        a.matchNumber - b.matchNumber,
    );
}

/**
 * Clubs at their anchor rating.
 *
 * Drift is always computed against these, never against whatever `elo` currently holds — that
 * is what makes a repeat run idempotent instead of compounding.
 */
export function anchoredTeams(repo: Repository) {
  return repo.getTeams().map((team) => ({ ...team, elo: team.anchorElo ?? team.elo }));
}

/** Rating each club would carry with the given results priced in, keyed by team id. */
export function ratingsAfter(
  repo: Repository,
  results: EloMatchInput[],
  eloK?: number,
): Map<number, number> {
  const anchored = anchoredTeams(repo);
  const deltas = computeEloDeltasFromMatches(anchored, results, eloK);
  return new Map(anchored.map((team) => [team.id, team.elo + (deltas.get(team.id) ?? 0)]));
}

/** Rating each club would carry with every real result to date priced in. */
export function ratingsFromRealResults(
  repo: Repository,
  eloK?: number,
): Map<number, number> {
  return ratingsAfter(repo, realResultsInOrder(repo), eloK);
}

export async function syncTeamRatingsFromResults(
  options: SyncRatingsFromResultsOptions,
): Promise<SyncRatingsSummary> {
  const { repo, dryRun = false, date = new Date(), eloK } = options;

  const ratings = ratingsFromRealResults(repo, eloK);
  const teams = repo.getTeams();

  // No result means no rating movement, so there is nothing new to record. `seed` writes the
  // opening baseline, so an empty season still has a first point to draw from.
  const snapshotDate = lastResultDate(repo);
  const asOf = snapshotDate ?? date.toISOString().slice(0, 10);

  // The database is the source of truth for the live rating; teams.csv is an input, and holds
  // the pre-season anchors this recomputes from.
  const before = new Map(teams.map((team) => [team.id, team.elo]));
  const next = teams.map((team) => ({
    id: team.id,
    name: team.name,
    elo: ratings.get(team.id) ?? team.elo,
  }));

  let updated = 0;
  let unchanged = 0;
  for (const team of teams) {
    if (Math.abs(team.elo - (ratings.get(team.id) ?? team.elo)) >= 1e-9) updated += 1;
    else unchanged += 1;
  }

  const movers = computeEloMoves(before, next);
  let snapshotted: number | undefined;

  if (!dryRun) {
    for (const team of teams) {
      const elo = ratings.get(team.id);
      if (elo == null) continue;
      // Pin the anchor the first time through, so a database seeded before this column existed
      // keeps its externally sourced rating rather than treating a drifted one as the baseline.
      if (team.anchorElo == null) repo.setTeamAnchorElo(team.id, team.elo);
      if (Math.abs(team.elo - elo) >= 1e-9) repo.updateTeamElo(team.id, elo);
    }

    // Nothing moved and this date is already on record: the write would restate what is
    // already there, so skip it and report honestly rather than upserting 20 identical rows.
    const alreadyRecorded = updated === 0 && repo.getEloHistoryDates().includes(asOf);
    if (snapshotDate != null && !alreadyRecorded) {
      snapshotted = repo.recordEloSnapshot(
        snapshotDate,
        teams.map((team) => ({ teamId: team.id, elo: ratings.get(team.id) ?? team.elo })),
      );
    }
  }

  return {
    updated,
    unchanged,
    dryRun,
    asOf,
    snapshotted,
    movers,
  };
}
