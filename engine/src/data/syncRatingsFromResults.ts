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
 * **The simulator must not drift on these results again.** Once a result is in the base, the
 * remainder-only run has to treat it as already priced in — exactly as it did when clubelo
 * owned the base. `SeasonRunner` and `runMonteCarlo` therefore drift only on matches they
 * simulated themselves. Moving that boundary in either direction double-counts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { computeEloDeltasFromMatches } from '../engine/seasonElo.js';
import type { Repository } from '../db/repository.js';
import { computeEloMoves, type SyncRatingsSummary } from './fetchRatings.js';
import {
  getDefaultTeamsCsvPath,
  loadTeamsCsvRecords,
  teamCsvRecordsToCsv,
  type TeamCsvRecord,
} from './teamsCsv.js';

export interface SyncRatingsFromResultsOptions {
  repo: Repository;
  dryRun?: boolean;
  writeCsv?: boolean;
  csvPath?: string;
  /** Dates the snapshot; defaults to today. */
  date?: Date;
  eloK?: number;
}

/**
 * Rating each club would carry with every real result to date priced in.
 *
 * Ordered by match number so the replay is deterministic and a club's later fixtures see its
 * earlier ones, matching how the simulator applies drift within a season.
 */
export function ratingsFromRealResults(
  repo: Repository,
  eloK?: number,
): Map<number, number> {
  const teams = repo.getTeams();
  const anchors = new Map(teams.map((team) => [team.id, team.anchorElo ?? team.elo]));

  const fixtures = new Map(repo.getFixtures().map((fixture) => [fixture.matchNumber, fixture]));
  const inputs = [...repo.getActualResultsByMatch().entries()]
    .sort(([a], [b]) => a - b)
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
        },
      ];
    });

  // Drift is computed against the anchors, not against whatever `elo` currently holds — that
  // is what makes a repeat run idempotent.
  const anchoredTeams = teams.map((team) => ({ ...team, elo: anchors.get(team.id)! }));
  const deltas = computeEloDeltasFromMatches(anchoredTeams, inputs, eloK);

  return new Map(
    teams.map((team) => [team.id, anchors.get(team.id)! + (deltas.get(team.id) ?? 0)]),
  );
}

export async function syncTeamRatingsFromResults(
  options: SyncRatingsFromResultsOptions,
): Promise<SyncRatingsSummary> {
  const {
    repo,
    dryRun = false,
    writeCsv = true,
    csvPath = getDefaultTeamsCsvPath(),
    date = new Date(),
    eloK,
  } = options;

  const ratings = ratingsFromRealResults(repo, eloK);
  const teams = repo.getTeams();
  const asOf = date.toISOString().slice(0, 10);

  // The database is the source of truth for the update itself; teams.csv is an output, and is
  // only read when it is about to be rewritten (it carries `clubelo_name`, which the DB does
  // not store).
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

    snapshotted = repo.recordEloSnapshot(
      asOf,
      teams.map((team) => ({ teamId: team.id, elo: ratings.get(team.id) ?? team.elo })),
    );

    if (writeCsv) {
      const records: TeamCsvRecord[] = loadTeamsCsvRecords(csvPath).map((record) => ({
        ...record,
        elo: ratings.get(record.id) ?? record.elo,
      }));
      await mkdir(dirname(csvPath), { recursive: true });
      await writeFile(csvPath, teamCsvRecordsToCsv(records), 'utf8');
    }
  }

  return {
    updated,
    unchanged,
    dryRun,
    asOf,
    csvPath: !dryRun && writeCsv ? csvPath : undefined,
    snapshotted,
    movers,
  };
}
