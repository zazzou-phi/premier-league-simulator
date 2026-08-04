import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ConsensusMode } from '../engine/consensus.js';

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  crest: text('crest'),
  elo: real('elo').notNull(),
});

export const fixtures = sqliteTable('fixtures', {
  matchNumber: integer('match_number').primaryKey(),
  matchday: integer('matchday').notNull(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  teamHomeId: integer('team_home_id')
    .notNull()
    .references(() => teams.id),
  teamAwayId: integer('team_away_id')
    .notNull()
    .references(() => teams.id),
});

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  upsetVariance: real('upset_variance').notNull(),
  seasonEloDeltaWeight: real('season_elo_delta_weight').notNull(),
});

export const simulations = sqliteTable('simulations', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const simulationMatches = sqliteTable(
  'simulation_matches',
  {
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    teamHomeId: integer('team_home_id')
      .notNull()
      .references(() => teams.id),
    teamAwayId: integer('team_away_id')
      .notNull()
      .references(() => teams.id),
    goalsHome: integer('goals_home'),
    goalsAway: integer('goals_away'),
    status: text('status').notNull().$type<'scheduled' | 'played'>(),
  },
  (t) => [primaryKey({ columns: [t.simulationId, t.matchNumber] })],
);

/**
 * Club Elo as it stood on a given day. `teams.elo` is overwritten in place by the weekly
 * ratings sync, so without this a past prediction cannot be tied to the ratings it used.
 */
export const teamEloHistory = sqliteTable(
  'team_elo_history',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    /** clubelo snapshot date, `YYYY-MM-DD`. */
    asOf: text('as_of').notNull(),
    elo: real('elo').notNull(),
    recordedAt: text('recorded_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.asOf] })],
);

export const actualMatchResults = sqliteTable('actual_match_results', {
  matchNumber: integer('match_number')
    .primaryKey()
    .references(() => fixtures.matchNumber),
  goalsHome: integer('goals_home').notNull(),
  goalsAway: integer('goals_away').notNull(),
  recordedAt: text('recorded_at').notNull(),
});

/**
 * A Monte Carlo batch. Individual runs are not stored — only the aggregate
 * distributions below plus a bounded reservoir of whole sampled seasons.
 */
export const predictions = sqliteTable('predictions', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  runs: integer('runs').notNull(),
  consensusMode: text('consensus_mode').notNull().$type<ConsensusMode>().default('outcome'),
  upsetVariance: real('upset_variance').notNull(),
  seasonEloDeltaWeight: real('season_elo_delta_weight').notNull(),
  elapsedMs: integer('elapsed_ms').notNull().default(0),
  /** Lowest matchday still unplayed when the batch ran; null for pre-provenance rows. */
  asOfMatchday: integer('as_of_matchday'),
  /** How many fixtures were already locked when the batch ran. */
  lockedCount: integer('locked_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Fixtures that were already locked when the batch ran. Monte Carlo replays locked results
 * verbatim, so these carry no predictive content and must be excluded when grading.
 */
export const predictionLockedMatches = sqliteTable(
  'prediction_locked_matches',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.matchNumber] })],
);

export const predictionMatchOutcomes = sqliteTable(
  'prediction_match_outcomes',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    homeWin: integer('home_win').notNull(),
    draw: integer('draw').notNull(),
    awayWin: integer('away_win').notNull(),
    total: integer('total').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.matchNumber] })],
);

export const predictionMatchScorelines = sqliteTable(
  'prediction_match_scorelines',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    goalsHome: integer('goals_home').notNull(),
    goalsAway: integer('goals_away').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.matchNumber, t.goalsHome, t.goalsAway] })],
);

/** Per-team finishing-position histogram; 20 rows per team regardless of run count. */
export const predictionTeamPositions = sqliteTable(
  'prediction_team_positions',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    position: integer('position').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.teamId, t.position] })],
);

export const predictionTeamStats = sqliteTable(
  'prediction_team_stats',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    totalPoints: integer('total_points').notNull(),
    totalGoalsFor: integer('total_goals_for').notNull(),
    totalGoalsAgainst: integer('total_goals_against').notNull(),
    positionSum: integer('position_sum').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.teamId] })],
);

/**
 * Reservoir of complete simulated seasons. Bounded by `reservoirSize` per prediction so
 * consensus 'sample' mode can draw a coherent season rather than independent fixtures.
 */
export const predictionSampledSeasons = sqliteTable(
  'prediction_sampled_seasons',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    sampleIndex: integer('sample_index').notNull(),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    goalsHome: integer('goals_home').notNull(),
    goalsAway: integer('goals_away').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.sampleIndex, t.matchNumber] })],
);

/** Which sampled season each prediction currently uses for 'sample' consensus. */
export const predictionActiveSample = sqliteTable('prediction_active_sample', {
  predictionId: integer('prediction_id')
    .primaryKey()
    .references(() => predictions.id),
  sampleIndex: integer('sample_index').notNull(),
});
