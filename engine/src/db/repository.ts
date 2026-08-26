import type Database from 'better-sqlite3';
import { and, asc, eq, sql } from 'drizzle-orm';
import { gradePrediction, type AccuracyReport } from '../engine/accuracy.js';
import {
  calibratedPicksFor,
  plausiblePicksFor,
  type SampledSeason,
} from '../engine/calibratedPicks.js';
import {
  choosePick,
  DEFAULT_PICK_STRATEGY,
  parsePickStrategy,
  type PickStrategy,
  type ScorelineCount,
} from '../engine/pickStrategy.js';
import { DEFAULT_UPSET_VARIANCE } from '../engine/matchSimulator.js';
import { DEFAULT_SEASON_ELO_DELTA_WEIGHT } from '../engine/seasonElo.js';
import { findNextMatchday } from '../engine/schedule.js';
import { computeLeagueStandings, type PlayedMatch } from '../engine/standings.js';
import type {
  ActualMatchResult,
  Fixture,
  ResolvedMatch,
  SeasonState,
  Simulation,
  SimulationMatch,
  StandingRow,
  Team,
} from '../engine/types.js';
import type { MatchDistribution, MonteCarloResult, TeamSeasonProjection } from '../simulation/monteCarlo.js';
import type { Db } from './client.js';
import { MatchLockedError, NotFoundError, ValidationError } from './errors.js';
import * as schema from './schema.js';

export interface Prediction {
  id: number;
  name: string;
  runs: number;
  pickStrategy: PickStrategy;
  upsetVariance: number;
  seasonEloDeltaWeight: number;
  /** Predictor-game payoff picks are scored against on this batch. */
  elapsedMs: number;
  /** Lowest matchday still unplayed when the batch ran; null for pre-provenance rows. */
  asOfMatchday: number | null;
  lockedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PredictionAccuracy extends AccuracyReport {
  predictionId: number;
  name: string;
  runs: number;
  pickStrategy: PickStrategy;
  asOfMatchday: number | null;
  createdAt: string;
}

/** One graded projection, reduced to the numbers worth trending across a season. */
export interface AccuracyHistoryPoint {
  predictionId: number;
  name: string;
  asOfMatchday: number | null;
  createdAt: string;
  runs: number;
  graded: number;
  brierScore: number;
  skillScore: number;
  logLoss: number;
  outcomeHitRate: number;
  scorelineHitRate: number;
}

export interface TeamEloSnapshot {
  teamId: number;
  asOf: string;
  elo: number;
  recordedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface AppSettings {
  upsetVariance: number;
  seasonEloDeltaWeight: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapTeam(row: typeof schema.teams.$inferSelect): Team {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    crest: row.crest,
    elo: row.elo,
    anchorElo: row.anchorElo,
  };
}

function mapFixture(row: typeof schema.fixtures.$inferSelect): Fixture {
  return {
    matchNumber: row.matchNumber,
    matchday: row.matchday,
    date: row.date,
    time: row.time,
    teamHomeId: row.teamHomeId,
    teamAwayId: row.teamAwayId,
  };
}



function mapPrediction(row: typeof schema.predictions.$inferSelect): Prediction {
  return {
    id: row.id,
    name: row.name,
    runs: row.runs,
    pickStrategy: parsePickStrategy(row.pickStrategy),
    upsetVariance: row.upsetVariance,
    seasonEloDeltaWeight: row.seasonEloDeltaWeight,
    elapsedMs: row.elapsedMs,
    asOfMatchday: row.asOfMatchday,
    lockedCount: row.lockedCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class Repository {
  constructor(private readonly db: Db) {}

  private get sqlite(): Database.Database {
    const client = (this.db as { $client?: Database.Database }).$client;
    if (!client) throw new Error('SQLite client unavailable');
    return client;
  }

  // ---------------------------------------------------------------- teams

  getTeams(): Team[] {
    return this.db.select().from(schema.teams).orderBy(asc(schema.teams.id)).all().map(mapTeam);
  }

  getTeamsById(): Map<number, Team> {
    return new Map(this.getTeams().map((team) => [team.id, team]));
  }

  /**
   * Pin the rating the current one is recomputed from.
   *
   * Set once, when a club first enters the league or a rating arrives from outside the model.
   * Overwriting it with an already-drifted rating would make the next recompute drift on top
   * of drift, so callers set it only where it is null.
   */
  setTeamAnchorElo(teamId: number, anchorElo: number): void {
    const existing = this.db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (!existing) throw new NotFoundError(`Team ${teamId}`);
    this.db.update(schema.teams).set({ anchorElo }).where(eq(schema.teams.id, teamId)).run();
  }

  updateTeamElo(teamId: number, elo: number): Team {
    const existing = this.db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (!existing) throw new NotFoundError(`Team ${teamId}`);
    this.db.update(schema.teams).set({ elo }).where(eq(schema.teams.id, teamId)).run();
    return mapTeam(this.db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get()!);
  }

  /**
   * Append a dated Elo snapshot. `teams.elo` is overwritten in place every weekly sync,
   * so this is the only record of what the model believed on a past date. Re-recording the
   * same day overwrites, which keeps a re-run of the same sync idempotent.
   */
  recordEloSnapshot(asOf: string, entries: Array<{ teamId: number; elo: number }>): number {
    const recordedAt = nowIso();
    const upsert = this.sqlite.prepare(
      `INSERT INTO team_elo_history (team_id, as_of, elo, recorded_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(team_id, as_of) DO UPDATE SET elo = excluded.elo, recorded_at = excluded.recorded_at`,
    );
    const write = this.sqlite.transaction(() => {
      for (const entry of entries) upsert.run(entry.teamId, asOf, entry.elo, recordedAt);
    });
    write();
    return entries.length;
  }

  /** Snapshots oldest-first, optionally narrowed to one team. */
  getEloHistory(teamId?: number): TeamEloSnapshot[] {
    const query = this.db.select().from(schema.teamEloHistory);
    const rows =
      teamId == null
        ? query.orderBy(asc(schema.teamEloHistory.asOf), asc(schema.teamEloHistory.teamId)).all()
        : query
            .where(eq(schema.teamEloHistory.teamId, teamId))
            .orderBy(asc(schema.teamEloHistory.asOf))
            .all();
    return rows;
  }

  /** Distinct snapshot dates, newest first. */
  getEloHistoryDates(): string[] {
    return this.db
      .selectDistinct({ asOf: schema.teamEloHistory.asOf })
      .from(schema.teamEloHistory)
      .orderBy(sql`${schema.teamEloHistory.asOf} DESC`)
      .all()
      .map((row) => row.asOf);
  }

  // ------------------------------------------------------------- fixtures

  getFixtures(): Fixture[] {
    return this.db
      .select()
      .from(schema.fixtures)
      .orderBy(asc(schema.fixtures.matchNumber))
      .all()
      .map(mapFixture);
  }

  getFixture(matchNumber: number): Fixture | null {
    const row = this.db
      .select()
      .from(schema.fixtures)
      .where(eq(schema.fixtures.matchNumber, matchNumber))
      .get();
    return row ? mapFixture(row) : null;
  }

  /**
   * Lowest matchday with an unplayed fixture — the round a fresh batch is predicting.
   * Null once every fixture is locked. Postponements mean this is not always the highest
   * played matchday plus one.
   */
  getNextMatchday(): number | null {
    return findNextMatchday(this.getFixtures(), new Set(this.getActualResultsByMatch().keys()));
  }

  // ------------------------------------------------------------- settings

  getSettings(): AppSettings {
    const row = this.db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1)).get();
    if (!row) {
      return {
        upsetVariance: DEFAULT_UPSET_VARIANCE,
        seasonEloDeltaWeight: DEFAULT_SEASON_ELO_DELTA_WEIGHT,
      };
    }
    return {
      upsetVariance: row.upsetVariance,
      seasonEloDeltaWeight: row.seasonEloDeltaWeight,
    };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const next = { ...current, ...patch };
    this.db
      .insert(schema.appSettings)
      .values({ id: 1, ...next })
      .onConflictDoUpdate({ target: schema.appSettings.id, set: next })
      .run();
    return next;
  }

  // ------------------------------------------------------- actual results

  getActualResults(): ActualMatchResult[] {
    return this.db
      .select()
      .from(schema.actualMatchResults)
      .orderBy(asc(schema.actualMatchResults.matchNumber))
      .all();
  }

  getActualResultsByMatch(): Map<number, { goalsHome: number; goalsAway: number }> {
    return new Map(
      this.getActualResults().map((row) => [
        row.matchNumber,
        { goalsHome: row.goalsHome, goalsAway: row.goalsAway },
      ]),
    );
  }

  setActualResult(matchNumber: number, goalsHome: number, goalsAway: number): ActualMatchResult {
    if (!this.getFixture(matchNumber)) throw new NotFoundError(`Fixture ${matchNumber}`);
    assertValidScore(goalsHome, goalsAway);

    const row = { matchNumber, goalsHome, goalsAway, recordedAt: nowIso() };
    this.db
      .insert(schema.actualMatchResults)
      .values(row)
      .onConflictDoUpdate({
        target: schema.actualMatchResults.matchNumber,
        set: { goalsHome, goalsAway, recordedAt: row.recordedAt },
      })
      .run();

    // Deliberately the only write. Stored simulations are never rewritten by reality —
    // every read path overlays actuals on top of them instead, so a simulation stays a
    // record of what it simulated. See buildSeasonStateFrom and SeasonRunner.withActuals.
    return row;
  }

  clearActualResult(matchNumber: number): void {
    this.db
      .delete(schema.actualMatchResults)
      .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
      .run();
  }

  // ---------------------------------------------------------- simulations

  listSimulations(page = 1, pageSize = 25): Page<Simulation> {
    const total = (
      this.db.select({ n: sql<number>`count(*)` }).from(schema.simulations).get() ?? { n: 0 }
    ).n;
    const items = this.db
      .select()
      .from(schema.simulations)
      .orderBy(sql`${schema.simulations.updatedAt} DESC`)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    return { items, total };
  }

  getSimulation(id: number): Simulation {
    const row = this.db.select().from(schema.simulations).where(eq(schema.simulations.id, id)).get();
    if (!row) throw new NotFoundError(`Simulation ${id}`);
    return row;
  }

  /**
   * A new simulation starts empty, even for fixtures that already have a real result.
   * Reality is overlaid at read time rather than copied in, so there is never a second
   * copy of a scoreline to fall out of step with `actual_match_results`.
   */
  createSimulation(name: string): Simulation {
    const fixtures = this.getFixtures();
    if (fixtures.length === 0) throw new ValidationError('No fixtures seeded');
    const timestamp = nowIso();

    return this.db.transaction((tx) => {
      const inserted = tx
        .insert(schema.simulations)
        .values({ name, createdAt: timestamp, updatedAt: timestamp })
        .returning()
        .get();

      for (const fixture of fixtures) {
        tx.insert(schema.simulationMatches)
          .values({
            simulationId: inserted.id,
            matchNumber: fixture.matchNumber,
            teamHomeId: fixture.teamHomeId,
            teamAwayId: fixture.teamAwayId,
            goalsHome: null,
            goalsAway: null,
            status: 'scheduled',
          })
          .run();
      }
      return inserted;
    });
  }

  renameSimulation(id: number, name: string): Simulation {
    this.getSimulation(id);
    this.db
      .update(schema.simulations)
      .set({ name, updatedAt: nowIso() })
      .where(eq(schema.simulations.id, id))
      .run();
    return this.getSimulation(id);
  }

  touchSimulation(id: number): void {
    this.db
      .update(schema.simulations)
      .set({ updatedAt: nowIso() })
      .where(eq(schema.simulations.id, id))
      .run();
  }

  deleteSimulation(id: number): void {
    this.db.transaction((tx) => {
      tx.delete(schema.simulationMatches)
        .where(eq(schema.simulationMatches.simulationId, id))
        .run();
      tx.delete(schema.simulations).where(eq(schema.simulations.id, id)).run();
    });
  }

  ensureDefaultSimulation(): Simulation {
    const existing = this.db
      .select()
      .from(schema.simulations)
      .orderBy(asc(schema.simulations.id))
      .limit(1)
      .get();
    return existing ?? this.createSimulation('Season 1');
  }

  getSimulationMatches(simulationId: number): SimulationMatch[] {
    return this.db
      .select()
      .from(schema.simulationMatches)
      .where(eq(schema.simulationMatches.simulationId, simulationId))
      .orderBy(asc(schema.simulationMatches.matchNumber))
      .all();
  }

  setMatchResult(
    simulationId: number,
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    options: { allowLocked?: boolean } = {},
  ): void {
    assertValidScore(goalsHome, goalsAway);
    if (!options.allowLocked && this.getActualResultsByMatch().has(matchNumber)) {
      throw new MatchLockedError(matchNumber);
    }
    this.db
      .update(schema.simulationMatches)
      .set({ goalsHome, goalsAway, status: 'played' })
      .where(
        and(
          eq(schema.simulationMatches.simulationId, simulationId),
          eq(schema.simulationMatches.matchNumber, matchNumber),
        ),
      )
      .run();
    this.touchSimulation(simulationId);
  }

  clearMatchResult(simulationId: number, matchNumber: number): void {
    if (this.getActualResultsByMatch().has(matchNumber)) throw new MatchLockedError(matchNumber);
    this.db
      .update(schema.simulationMatches)
      .set({ goalsHome: null, goalsAway: null, status: 'scheduled' })
      .where(
        and(
          eq(schema.simulationMatches.simulationId, simulationId),
          eq(schema.simulationMatches.matchNumber, matchNumber),
        ),
      )
      .run();
    this.touchSimulation(simulationId);
  }

  /** Bulk write used by the season runner; assumes locked fixtures were already filtered out. */
  applyMatchResults(
    simulationId: number,
    results: Array<{ matchNumber: number; goalsHome: number; goalsAway: number }>,
  ): void {
    const update = this.sqlite.prepare(
      `UPDATE simulation_matches
       SET goals_home = ?, goals_away = ?, status = 'played'
       WHERE simulation_id = ? AND match_number = ?`,
    );
    const apply = this.sqlite.transaction(() => {
      for (const result of results) {
        update.run(result.goalsHome, result.goalsAway, simulationId, result.matchNumber);
      }
    });
    apply();
    this.touchSimulation(simulationId);
  }

  buildSeasonState(simulationId: number): SeasonState {
    this.getSimulation(simulationId);
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixturesByNumber = new Map(this.getFixtures().map((f) => [f.matchNumber, f]));
    const actuals = this.getActualResultsByMatch();
    const rows = this.getSimulationMatches(simulationId);

    return buildSeasonStateFrom(simulationId, teams, teamsById, fixturesByNumber, rows, actuals);
  }

  // ---------------------------------------------------------- predictions

  /**
   * Saved batches, most recently *run* first.
   *
   * Ordered on `createdAt` rather than `updatedAt` so that renaming an old batch, or switching
   * its pick strategy, does not promote it over newer runs — the first item is what the app
   * opens on, and that should be the last simulation run.
   */
  listPredictions(page = 1, pageSize = 25): Page<Prediction> {
    const total = (
      this.db.select({ n: sql<number>`count(*)` }).from(schema.predictions).get() ?? { n: 0 }
    ).n;
    const items = this.db
      .select()
      .from(schema.predictions)
      .orderBy(sql`${schema.predictions.createdAt} DESC`)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all()
      .map(mapPrediction);
    return { items, total };
  }

  getPrediction(id: number): Prediction {
    const row = this.db.select().from(schema.predictions).where(eq(schema.predictions.id, id)).get();
    if (!row) throw new NotFoundError(`Prediction ${id}`);
    return mapPrediction(row);
  }

  /** The batch an export ships: the last one run, matching what the app opens on. */
  getActivePrediction(): Prediction | null {
    const row = this.db
      .select()
      .from(schema.predictions)
      .orderBy(sql`${schema.predictions.createdAt} DESC`)
      .limit(1)
      .get();
    return row ? mapPrediction(row) : null;
  }

  updatePrediction(
    id: number,
    patch: {
      name?: string;
      pickStrategy?: PickStrategy;
    },
  ): Prediction {
    this.getPrediction(id);
    const set: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.pickStrategy !== undefined) set.pickStrategy = patch.pickStrategy;
    this.db.update(schema.predictions).set(set).where(eq(schema.predictions.id, id)).run();
    return this.getPrediction(id);
  }

  deletePrediction(id: number): void {
    this.db.transaction((tx) => {
      for (const table of [
        schema.predictionSampledSeasons,
        schema.predictionActiveSample,
        schema.predictionTeamStats,
        schema.predictionTeamPositions,
        schema.predictionMatchScorelines,
        schema.predictionMatchOutcomes,
        schema.predictionLockedMatches,
      ]) {
        tx.delete(table).where(eq(table.predictionId, id)).run();
      }
      tx.delete(schema.predictions).where(eq(schema.predictions.id, id)).run();
    });
  }

  /**
   * Persist a Monte Carlo batch as a prediction. Only aggregates and the sampled-season
   * reservoir are written, so storage is bounded by fixture count rather than run count.
   */
  savePredictionFromMonteCarlo(name: string, result: MonteCarloResult): Prediction {
    const settings = this.getSettings();
    const timestamp = nowIso();
    const lockedMatches = [...this.getActualResultsByMatch().keys()].sort((a, b) => a - b);
    const asOfMatchday = this.getNextMatchday();

    const save = this.sqlite.transaction(() => {
      const inserted = this.db
        .insert(schema.predictions)
        .values({
          name,
          runs: result.runs,
          pickStrategy: DEFAULT_PICK_STRATEGY,
          upsetVariance: settings.upsetVariance,
          seasonEloDeltaWeight: settings.seasonEloDeltaWeight,
          elapsedMs: result.elapsedMs,
          asOfMatchday,
          lockedCount: lockedMatches.length,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()
        .get();

      const predictionId = inserted.id;

      // Grading later needs to know which fixtures the batch was simply told the answer to.
      const insertLocked = this.sqlite.prepare(
        `INSERT INTO prediction_locked_matches (prediction_id, match_number) VALUES (?, ?)`,
      );
      for (const matchNumber of lockedMatches) {
        insertLocked.run(predictionId, matchNumber);
      }

      const insertOutcome = this.sqlite.prepare(
        `INSERT INTO prediction_match_outcomes
           (prediction_id, match_number, home_win, draw, away_win, total)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertScoreline = this.sqlite.prepare(
        `INSERT INTO prediction_match_scorelines
           (prediction_id, match_number, goals_home, goals_away, count)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const dist of result.matchDistributions) {
        insertOutcome.run(
          predictionId,
          dist.matchNumber,
          dist.outcomes.homeWin,
          dist.outcomes.draw,
          dist.outcomes.awayWin,
          dist.outcomes.total,
        );
        for (const scoreline of dist.scorelines) {
          insertScoreline.run(
            predictionId,
            dist.matchNumber,
            scoreline.goalsHome,
            scoreline.goalsAway,
            scoreline.n,
          );
        }
      }

      const insertPosition = this.sqlite.prepare(
        `INSERT INTO prediction_team_positions (prediction_id, team_id, position, count)
         VALUES (?, ?, ?, ?)`,
      );
      const insertStats = this.sqlite.prepare(
        `INSERT INTO prediction_team_stats
           (prediction_id, team_id, total_points, total_goals_for, total_goals_against, position_sum)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const team of result.teams) {
        team.positionCounts.forEach((count, index) => {
          if (count > 0) insertPosition.run(predictionId, team.teamId, index + 1, count);
        });
        insertStats.run(
          predictionId,
          team.teamId,
          Math.round(team.averagePoints * result.runs),
          Math.round(team.averageGoalsFor * result.runs),
          Math.round(team.averageGoalsAgainst * result.runs),
          Math.round(team.averagePosition * result.runs),
        );
      }

      const insertSample = this.sqlite.prepare(
        `INSERT INTO prediction_sampled_seasons
           (prediction_id, sample_index, match_number, goals_home, goals_away)
         VALUES (?, ?, ?, ?, ?)`,
      );
      result.sampledSeasons.forEach((season, sampleIndex) => {
        for (const match of season.matches) {
          insertSample.run(
            predictionId,
            sampleIndex,
            match.matchNumber,
            match.goalsHome,
            match.goalsAway,
          );
        }
      });

      if (result.sampledSeasons.length > 0) {
        this.sqlite
          .prepare(
            `INSERT INTO prediction_active_sample (prediction_id, sample_index) VALUES (?, 0)`,
          )
          .run(predictionId);
      }

      return inserted;
    });

    return mapPrediction(save());
  }

  getPredictionProjections(predictionId: number): {
    runs: number;
    teams: TeamSeasonProjection[];
  } {
    const prediction = this.getPrediction(predictionId);
    const teams = this.getTeams();
    const teamCount = teams.length;

    const positionRows = this.db
      .select()
      .from(schema.predictionTeamPositions)
      .where(eq(schema.predictionTeamPositions.predictionId, predictionId))
      .all();
    const statsRows = this.db
      .select()
      .from(schema.predictionTeamStats)
      .where(eq(schema.predictionTeamStats.predictionId, predictionId))
      .all();

    const positionsByTeam = new Map<number, number[]>();
    for (const row of positionRows) {
      let counts = positionsByTeam.get(row.teamId);
      if (!counts) {
        counts = new Array<number>(teamCount).fill(0);
        positionsByTeam.set(row.teamId, counts);
      }
      counts[row.position - 1] = row.count;
    }
    const statsByTeam = new Map(statsRows.map((row) => [row.teamId, row]));

    const runs = prediction.runs;
    const relegationCutoff = teamCount - 3;

    const projections = teams
      .map((team) => {
        const positionCounts = positionsByTeam.get(team.id) ?? new Array<number>(teamCount).fill(0);
        const stats = statsByTeam.get(team.id);
        const countsIn = (from: number, to: number) =>
          positionCounts.slice(from - 1, to).reduce((sum, n) => sum + n, 0);

        return {
          teamId: team.id,
          teamName: team.name,
          positionCounts,
          titleProbability: (positionCounts[0] ?? 0) / runs,
          championsLeagueProbability: countsIn(1, 4) / runs,
          europeanProbability: countsIn(1, 5) / runs,
          relegationProbability: countsIn(relegationCutoff + 1, teamCount) / runs,
          averagePosition: (stats?.positionSum ?? 0) / runs,
          averagePoints: (stats?.totalPoints ?? 0) / runs,
          averageGoalsFor: (stats?.totalGoalsFor ?? 0) / runs,
          averageGoalsAgainst: (stats?.totalGoalsAgainst ?? 0) / runs,
        } satisfies TeamSeasonProjection;
      })
      .sort(
        (a, b) =>
          a.averagePosition - b.averagePosition ||
          b.averagePoints - a.averagePoints ||
          a.teamName.localeCompare(b.teamName),
      );

    return { runs, teams: projections };
  }

  getPredictionDistributions(predictionId: number): Map<number, MatchDistribution> {
    const outcomeRows = this.db
      .select()
      .from(schema.predictionMatchOutcomes)
      .where(eq(schema.predictionMatchOutcomes.predictionId, predictionId))
      .all();
    const scorelineRows = this.db
      .select()
      .from(schema.predictionMatchScorelines)
      .where(eq(schema.predictionMatchScorelines.predictionId, predictionId))
      .all();

    const scorelinesByMatch = new Map<number, ScorelineCount[]>();
    for (const row of scorelineRows) {
      const list = scorelinesByMatch.get(row.matchNumber) ?? [];
      list.push({ goalsHome: row.goalsHome, goalsAway: row.goalsAway, n: row.count });
      scorelinesByMatch.set(row.matchNumber, list);
    }

    const result = new Map<number, MatchDistribution>();
    for (const row of outcomeRows) {
      result.set(row.matchNumber, {
        matchNumber: row.matchNumber,
        outcomes: {
          homeWin: row.homeWin,
          draw: row.draw,
          awayWin: row.awayWin,
          total: row.total,
        },
        scorelines: (scorelinesByMatch.get(row.matchNumber) ?? []).sort(
          (a, b) => b.n - a.n || a.goalsHome - b.goalsHome || a.goalsAway - b.goalsAway,
        ),
      });
    }
    return result;
  }

  /** Fixtures already locked when the batch ran, so grading can exclude them. */
  getPredictionLockedMatches(predictionId: number): Set<number> {
    const rows = this.db
      .select()
      .from(schema.predictionLockedMatches)
      .where(eq(schema.predictionLockedMatches.predictionId, predictionId))
      .all();
    return new Set(rows.map((row) => row.matchNumber));
  }

  /** How many fixtures this batch predicted blind have a real result now. */
  countGradeableMatches(predictionId: number): number {
    const row = this.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM actual_match_results
         WHERE match_number NOT IN (
           SELECT match_number FROM prediction_locked_matches WHERE prediction_id = ?
         )`,
      )
      .get(predictionId) as { n: number };
    return row.n;
  }

  getMatchDistribution(predictionId: number, matchNumber: number): MatchDistribution {
    const distribution = this.getPredictionDistributions(predictionId).get(matchNumber);
    if (!distribution) throw new NotFoundError(`Distribution for match ${matchNumber}`);
    return distribution;
  }

  private getActiveSampleResults(
    predictionId: number,
  ): Map<number, { goalsHome: number; goalsAway: number }> {
    const active = this.db
      .select()
      .from(schema.predictionActiveSample)
      .where(eq(schema.predictionActiveSample.predictionId, predictionId))
      .get();
    if (!active) return new Map();

    const rows = this.db
      .select()
      .from(schema.predictionSampledSeasons)
      .where(
        and(
          eq(schema.predictionSampledSeasons.predictionId, predictionId),
          eq(schema.predictionSampledSeasons.sampleIndex, active.sampleIndex),
        ),
      )
      .all();
    return new Map(
      rows.map((row) => [row.matchNumber, { goalsHome: row.goalsHome, goalsAway: row.goalsAway }]),
    );
  }

  /**
   * Every season in the batch's reservoir, in sample order. `plausible` ranks these to find the
   * draw profile it aims at, where `random` replays just the one {@link setActiveSample} names.
   */
  private getSampledSeasons(predictionId: number): SampledSeason[] {
    const rows = this.db
      .select()
      .from(schema.predictionSampledSeasons)
      .where(eq(schema.predictionSampledSeasons.predictionId, predictionId))
      .all();

    const bySample = new Map<number, Map<number, { goalsHome: number; goalsAway: number }>>();
    for (const row of rows) {
      let season = bySample.get(row.sampleIndex);
      if (!season) {
        season = new Map();
        bySample.set(row.sampleIndex, season);
      }
      season.set(row.matchNumber, { goalsHome: row.goalsHome, goalsAway: row.goalsAway });
    }

    return [...bySample.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, season]) => season);
  }

  countSampledSeasons(predictionId: number): number {
    const row = this.db
      .select({ n: sql<number>`count(distinct sample_index)` })
      .from(schema.predictionSampledSeasons)
      .where(eq(schema.predictionSampledSeasons.predictionId, predictionId))
      .get();
    return row?.n ?? 0;
  }

  setActiveSample(predictionId: number, sampleIndex: number): void {
    const available = this.countSampledSeasons(predictionId);
    if (sampleIndex < 0 || sampleIndex >= available) {
      throw new ValidationError(
        `sampleIndex must be between 0 and ${Math.max(0, available - 1)}, got ${sampleIndex}`,
      );
    }
    this.db
      .insert(schema.predictionActiveSample)
      .values({ predictionId, sampleIndex })
      .onConflictDoUpdate({
        target: schema.predictionActiveSample.predictionId,
        set: { sampleIndex },
      })
      .run();
  }

  /** The season-wide assignment a strategy picks from, or null for the per-fixture rules. */
  private seasonPicksFor(
    predictionId: number,
    strategy: PickStrategy,
    fixtures: Fixture[],
    distributions: ReturnType<Repository['getPredictionDistributions']>,
  ): Map<number, { goalsHome: number; goalsAway: number }> | null {
    if (strategy === 'calibrated') return calibratedPicksFor(fixtures, distributions);
    if (strategy === 'plausible') {
      return plausiblePicksFor(fixtures, distributions, this.getSampledSeasons(predictionId));
    }
    return null;
  }

  /** Collapse a prediction's distributions into a single representative season. */
  buildPredictionState(predictionId: number): SeasonState {
    const prediction = this.getPrediction(predictionId);
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixtures = this.getFixtures();
    const actuals = this.getActualResultsByMatch();
    const distributions = this.getPredictionDistributions(predictionId);
    const sample =
      prediction.pickStrategy === 'random' ? this.getActiveSampleResults(predictionId) : null;
    // Season-wide, so it is solved once for the whole fixture list rather than per fixture.
    const seasonPicks = this.seasonPicksFor(
      predictionId,
      prediction.pickStrategy,
      fixtures,
      distributions,
    );

    const matches: ResolvedMatch[] = fixtures.map((fixture) => {
      const teamHome = teamsById.get(fixture.teamHomeId)!;
      const teamAway = teamsById.get(fixture.teamAwayId)!;
      const actual = actuals.get(fixture.matchNumber);

      if (actual) {
        return {
          fixture,
          teamHome,
          teamAway,
          result: { goalsHome: actual.goalsHome, goalsAway: actual.goalsAway, status: 'played' },
          locked: true,
        };
      }

      const distribution = distributions.get(fixture.matchNumber);
      const pick = distribution
        ? choosePick({
            strategy: prediction.pickStrategy,
            savedSample: sample?.get(fixture.matchNumber) ?? null,
            seasonPick: seasonPicks?.get(fixture.matchNumber) ?? null,
          })
        : null;

      return {
        fixture,
        teamHome,
        teamAway,
        result: {
          goalsHome: pick?.goalsHome ?? null,
          goalsAway: pick?.goalsAway ?? null,
          status: pick ? 'played' : 'scheduled',
        },
        locked: false,
      };
    });

    return finalizeSeasonState(predictionId, teams, matches);
  }

  /**
   * Grade a stored batch against the results that have landed since it ran. Fixtures that
   * were already locked when it ran are excluded — the batch replayed those verbatim.
   */
  getPredictionAccuracy(predictionId: number): PredictionAccuracy {
    const prediction = this.getPrediction(predictionId);
    const report = gradePrediction(
      {
        pickStrategy: prediction.pickStrategy,
        fixtures: this.getFixtures(),
        teamsById: this.getTeamsById(),
        distributions: this.getPredictionDistributions(predictionId),
        actuals: this.getActualResultsByMatch(),
        lockedAtRunTime: this.getPredictionLockedMatches(predictionId),
        activeSample:
          prediction.pickStrategy === 'random'
            ? this.getActiveSampleResults(predictionId)
            : null,
        sampledSeasons:
          prediction.pickStrategy === 'plausible'
            ? this.getSampledSeasons(predictionId)
            : null,
      },
      prediction.runs,
    );

    return {
      predictionId: prediction.id,
      name: prediction.name,
      runs: prediction.runs,
      pickStrategy: prediction.pickStrategy,
      asOfMatchday: prediction.asOfMatchday,
      createdAt: prediction.createdAt,
      ...report,
    };
  }

  /**
   * Every projection that has something to grade, in the order it faced the season.
   * This is the "are we getting better or worse" series — one point per week of the loop.
   * Ungraded batches are omitted rather than shown as zero, which would read as a bad week.
   */
  getAccuracyHistory(): AccuracyHistoryPoint[] {
    return this.listPredictions(1, 1000)
      .items.filter((prediction) => this.countGradeableMatches(prediction.id) > 0)
      .map((prediction) => this.getPredictionAccuracy(prediction.id))
      .filter((report) => report.graded > 0)
      .map((report) => ({
        predictionId: report.predictionId,
        name: report.name,
        asOfMatchday: report.asOfMatchday,
        createdAt: report.createdAt,
        runs: report.runs,
        graded: report.graded,
        brierScore: report.brierScore,
        skillScore: report.skillScore,
        logLoss: report.logLoss,
        outcomeHitRate: report.outcomeHitRate,
        scorelineHitRate: report.scorelineHitRate,
      }))
      .sort(
        (a, b) =>
          (a.asOfMatchday ?? Number.MAX_SAFE_INTEGER) -
            (b.asOfMatchday ?? Number.MAX_SAFE_INTEGER) ||
          a.createdAt.localeCompare(b.createdAt),
      );
  }

  // ------------------------------------------------- actual-results state

  buildActualResultsState(): SeasonState {
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const actuals = this.getActualResultsByMatch();

    const matches: ResolvedMatch[] = this.getFixtures().map((fixture) => {
      const actual = actuals.get(fixture.matchNumber);
      return {
        fixture,
        teamHome: teamsById.get(fixture.teamHomeId)!,
        teamAway: teamsById.get(fixture.teamAwayId)!,
        result: {
          goalsHome: actual?.goalsHome ?? null,
          goalsAway: actual?.goalsAway ?? null,
          status: actual ? 'played' : 'scheduled',
        },
        locked: actual != null,
      };
    });

    return finalizeSeasonState(0, teams, matches);
  }
}

function assertValidScore(goalsHome: number, goalsAway: number): void {
  for (const [label, value] of [
    ['goalsHome', goalsHome],
    ['goalsAway', goalsAway],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 99) {
      throw new ValidationError(`${label} must be an integer between 0 and 99, got ${value}`);
    }
  }
}

/**
 * Overlay real results on top of a simulation's own rows.
 *
 * A locked fixture takes both its scoreline and its status from `actual_match_results`, not
 * from the stored row — the stored row keeps whatever the simulation produced. Standings fall
 * out of the overlaid matches in {@link finalizeSeasonState}, so the table agrees with reality
 * without anything having been rewritten on disk.
 */
function buildSeasonStateFrom(
  simulationId: number,
  teams: Team[],
  teamsById: Map<number, Team>,
  fixturesByNumber: Map<number, Fixture>,
  rows: SimulationMatch[],
  actuals: Map<number, { goalsHome: number; goalsAway: number }>,
): SeasonState {
  const matches: ResolvedMatch[] = rows.flatMap((row) => {
    const fixture = fixturesByNumber.get(row.matchNumber);
    const teamHome = teamsById.get(row.teamHomeId);
    const teamAway = teamsById.get(row.teamAwayId);
    if (!fixture || !teamHome || !teamAway) return [];

    const actual = actuals.get(row.matchNumber);

    return [
      {
        fixture,
        teamHome,
        teamAway,
        result: actual
          ? { goalsHome: actual.goalsHome, goalsAway: actual.goalsAway, status: 'played' as const }
          : {
              goalsHome: row.goalsHome,
              goalsAway: row.goalsAway,
              status: row.status,
            },
        locked: actual != null,
      },
    ];
  });

  return finalizeSeasonState(simulationId, teams, matches);
}

function finalizeSeasonState(
  simulationId: number,
  teams: Team[],
  matches: ResolvedMatch[],
): SeasonState {
  const played: PlayedMatch[] = matches.flatMap((match) =>
    match.result.status === 'played' &&
    match.result.goalsHome != null &&
    match.result.goalsAway != null
      ? [
          {
            homeTeamId: match.teamHome.id,
            awayTeamId: match.teamAway.id,
            goalsHome: match.result.goalsHome,
            goalsAway: match.result.goalsAway,
          },
        ]
      : [],
  );

  const standings: StandingRow[] = computeLeagueStandings(teams, played);

  return {
    simulationId,
    teams,
    matches,
    standings,
    matchesPlayed: played.length,
    matchesTotal: matches.length,
  };
}
