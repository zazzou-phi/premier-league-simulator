import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { MatchLockedError, NotFoundError, ValidationError } from '../src/db/errors.js';
import type { Repository } from '../src/db/repository.js';
import { runMonteCarlo } from '../src/simulation/monteCarlo.js';
import { SeasonRunner } from '../src/simulation/runner.js';
import { createTestRepository } from './testDb.js';
import { testRng } from './testRng.js';

let repo: Repository;
let sqlite: Database.Database;

beforeEach(() => {
  ({ repo, sqlite } = createTestRepository());
});

describe('teams and fixtures', () => {
  it('seeds 20 teams and 380 fixtures', () => {
    expect(repo.getTeams()).toHaveLength(20);
    expect(repo.getFixtures()).toHaveLength(380);
  });

  it('persists Elo edits', () => {
    repo.updateTeamElo(20, 2200);
    const after = repo.getTeams().find((t) => t.id === 20)!;
    expect(after.elo).toBe(2200);
  });

  it('rejects an unknown team', () => {
    expect(() => repo.updateTeamElo(999, 1800)).toThrow(NotFoundError);
  });
});

describe('simulations', () => {
  it('creates a simulation with a row per fixture', () => {
    const simulation = repo.createSimulation('Test');
    expect(repo.getSimulationMatches(simulation.id)).toHaveLength(380);
  });

  it('starts every match scheduled with an empty table', () => {
    const simulation = repo.createSimulation('Test');
    const state = repo.buildSeasonState(simulation.id);
    expect(state.matchesPlayed).toBe(0);
    expect(state.matchesTotal).toBe(380);
    expect(state.standings).toHaveLength(20);
    expect(state.standings.every((row) => row.played === 0)).toBe(true);
  });

  it('records a score and reflects it in the table', () => {
    const simulation = repo.createSimulation('Test');
    const fixture = repo.getFixtures()[0]!;
    repo.setMatchResult(simulation.id, fixture.matchNumber, 3, 1);

    const state = repo.buildSeasonState(simulation.id);
    expect(state.matchesPlayed).toBe(1);
    const home = state.standings.find((row) => row.teamId === fixture.teamHomeId)!;
    expect(home.points).toBe(3);
    expect(home.goalsFor).toBe(3);
  });

  it('clears a score', () => {
    const simulation = repo.createSimulation('Test');
    const fixture = repo.getFixtures()[0]!;
    repo.setMatchResult(simulation.id, fixture.matchNumber, 2, 2);
    repo.clearMatchResult(simulation.id, fixture.matchNumber);
    expect(repo.buildSeasonState(simulation.id).matchesPlayed).toBe(0);
  });

  it('rejects invalid scores', () => {
    const simulation = repo.createSimulation('Test');
    expect(() => repo.setMatchResult(simulation.id, 1, -1, 0)).toThrow(ValidationError);
    expect(() => repo.setMatchResult(simulation.id, 1, 1.5, 0)).toThrow(ValidationError);
    expect(() => repo.setMatchResult(simulation.id, 1, 0, 100)).toThrow(ValidationError);
  });

  it('renames and deletes', () => {
    const simulation = repo.createSimulation('Old');
    expect(repo.renameSimulation(simulation.id, 'New').name).toBe('New');
    repo.deleteSimulation(simulation.id);
    expect(() => repo.getSimulation(simulation.id)).toThrow(NotFoundError);
  });

  it('reuses the first simulation as the default', () => {
    const first = repo.ensureDefaultSimulation();
    expect(repo.ensureDefaultSimulation().id).toBe(first.id);
  });

  it('paginates', () => {
    for (let i = 0; i < 5; i++) repo.createSimulation(`Sim ${i}`);
    const page = repo.listSimulations(1, 2);
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
  });
});

describe('actual results', () => {
  it('propagates a real result into every simulation', () => {
    const a = repo.createSimulation('A');
    const b = repo.createSimulation('B');
    repo.setActualResult(1, 4, 0);

    for (const id of [a.id, b.id]) {
      const match = repo.getSimulationMatches(id).find((m) => m.matchNumber === 1)!;
      expect(match).toMatchObject({ goalsHome: 4, goalsAway: 0, status: 'played' });
    }
  });

  it('marks the fixture locked in season state', () => {
    const simulation = repo.createSimulation('A');
    repo.setActualResult(1, 1, 1);
    const match = repo.buildSeasonState(simulation.id).matches.find((m) => m.fixture.matchNumber === 1)!;
    expect(match.locked).toBe(true);
  });

  it('refuses to overwrite a locked match', () => {
    const simulation = repo.createSimulation('A');
    repo.setActualResult(1, 1, 1);
    expect(() => repo.setMatchResult(simulation.id, 1, 2, 0)).toThrow(MatchLockedError);
    expect(() => repo.clearMatchResult(simulation.id, 1)).toThrow(MatchLockedError);
  });

  it('unlocks when the real result is cleared', () => {
    const simulation = repo.createSimulation('A');
    repo.setActualResult(1, 1, 1);
    repo.clearActualResult(1);
    expect(() => repo.setMatchResult(simulation.id, 1, 2, 0)).not.toThrow();
  });

  it('rejects an unknown fixture', () => {
    expect(() => repo.setActualResult(9999, 1, 0)).toThrow(NotFoundError);
  });

  it('builds a standings view from real results alone', () => {
    repo.setActualResult(1, 2, 0);
    const state = repo.buildActualResultsState();
    expect(state.matchesPlayed).toBe(1);
    expect(state.standings.reduce((sum, row) => sum + row.played, 0)).toBe(2);
  });
});

describe('SeasonRunner', () => {
  it('plays the whole season', () => {
    const simulation = repo.createSimulation('Run');
    const result = new SeasonRunner(repo, { rng: testRng(1) }).simulateRestOfSeason(simulation.id);
    expect(result.matchesPlayed).toBe(380);

    const state = repo.buildSeasonState(simulation.id);
    expect(state.matchesPlayed).toBe(380);
    expect(state.standings.every((row) => row.played === 38)).toBe(true);
    expect(state.standings.reduce((sum, row) => sum + row.points, 0)).toBeGreaterThan(0);
  });

  it('simulates only up to a given matchday', () => {
    const simulation = repo.createSimulation('Run');
    new SeasonRunner(repo, { rng: testRng(2) }).simulateUpToMatchday(simulation.id, 5);
    const state = repo.buildSeasonState(simulation.id);
    expect(state.matchesPlayed).toBe(50);
    expect(state.standings.every((row) => row.played === 5)).toBe(true);
  });

  it('advances one matchday at a time', () => {
    const simulation = repo.createSimulation('Run');
    const runner = new SeasonRunner(repo, { rng: testRng(3) });
    runner.simulateNextMatchday(simulation.id);
    expect(repo.buildSeasonState(simulation.id).matchesPlayed).toBe(10);
    runner.simulateNextMatchday(simulation.id);
    expect(repo.buildSeasonState(simulation.id).matchesPlayed).toBe(20);
  });

  it('leaves already played matches untouched', () => {
    const simulation = repo.createSimulation('Run');
    repo.setMatchResult(simulation.id, 1, 5, 5);
    new SeasonRunner(repo, { rng: testRng(4) }).simulateRestOfSeason(simulation.id);

    const match = repo.getSimulationMatches(simulation.id).find((m) => m.matchNumber === 1)!;
    expect(match.goalsHome).toBe(5);
    expect(match.goalsAway).toBe(5);
  });

  it('never overwrites a locked result', () => {
    const simulation = repo.createSimulation('Run');
    repo.setActualResult(7, 3, 2);
    new SeasonRunner(repo, { rng: testRng(5) }).simulateRestOfSeason(simulation.id);

    const match = repo.getSimulationMatches(simulation.id).find((m) => m.matchNumber === 7)!;
    expect(match.goalsHome).toBe(3);
    expect(match.goalsAway).toBe(2);
  });

  it('simulates a single match', () => {
    const simulation = repo.createSimulation('Run');
    const result = new SeasonRunner(repo, { rng: testRng(6) }).simulateSingleMatch(simulation.id, 3);
    expect(result.matchesPlayed).toBe(1);
    expect(repo.buildSeasonState(simulation.id).matchesPlayed).toBe(1);
  });

  it('reports an unknown match', () => {
    const simulation = repo.createSimulation('Run');
    expect(() => new SeasonRunner(repo).simulateSingleMatch(simulation.id, 9999)).toThrow(
      NotFoundError,
    );
  });
});

describe('settings', () => {
  it('round-trips values', () => {
    expect(repo.getSettings().upsetVariance).toBeCloseTo(0.2, 6);
    repo.updateSettings({ upsetVariance: 0.35 });
    expect(repo.getSettings().upsetVariance).toBeCloseTo(0.35, 6);
    expect(repo.getSettings().seasonEloDeltaWeight).toBeCloseTo(1, 6);
  });
});

describe('predictions', () => {
  async function seedPrediction(runs = 25) {
    const result = await runMonteCarlo(repo.getTeams(), repo.getFixtures(), {
      runs,
      rng: testRng(31),
      reservoirSize: 5,
    });
    return { prediction: repo.savePredictionFromMonteCarlo('MC', result), result };
  }

  it('stores aggregates without storing individual runs', async () => {
    const { prediction } = await seedPrediction(25);
    expect(prediction.runs).toBe(25);

    const scorelineRows = (
      sqlite.prepare('SELECT COUNT(*) AS n FROM prediction_match_scorelines').get() as { n: number }
    ).n;
    const sampleRows = (
      sqlite.prepare('SELECT COUNT(DISTINCT sample_index) AS n FROM prediction_sampled_seasons').get() as {
        n: number;
      }
    ).n;

    // Bounded by distinct scorelines per fixture, not by run count.
    expect(scorelineRows).toBeGreaterThan(0);
    expect(scorelineRows).toBeLessThan(380 * 25);
    expect(sampleRows).toBe(5);
  });

  it('reproduces projection probabilities from stored aggregates', async () => {
    const { prediction, result } = await seedPrediction(25);
    const stored = repo.getPredictionProjections(prediction.id);

    expect(stored.runs).toBe(25);
    const storedByTeam = new Map(stored.teams.map((t) => [t.teamId, t]));
    for (const team of result.teams) {
      const match = storedByTeam.get(team.teamId)!;
      expect(match.titleProbability).toBeCloseTo(team.titleProbability, 10);
      expect(match.relegationProbability).toBeCloseTo(team.relegationProbability, 10);
      expect(match.averagePoints).toBeCloseTo(team.averagePoints, 6);
    }
  });

  it('keeps probability mass consistent', async () => {
    const { prediction } = await seedPrediction(20);
    const { teams } = repo.getPredictionProjections(prediction.id);
    const sum = (pick: (t: (typeof teams)[number]) => number) =>
      teams.reduce((total, team) => total + pick(team), 0);

    expect(sum((t) => t.titleProbability)).toBeCloseTo(1, 6);
    expect(sum((t) => t.championsLeagueProbability)).toBeCloseTo(4, 6);
    expect(sum((t) => t.relegationProbability)).toBeCloseTo(3, 6);
  });

  it('round-trips match distributions', async () => {
    const { prediction, result } = await seedPrediction(20);
    const stored = repo.getMatchDistribution(prediction.id, 1);
    const expected = result.matchDistributions.find((d) => d.matchNumber === 1)!;

    expect(stored.outcomes).toEqual(expected.outcomes);
    expect(stored.scorelines.reduce((sum, s) => sum + s.n, 0)).toBe(20);
  });

  it('builds a consensus season for every consensus mode', async () => {
    const { prediction } = await seedPrediction(25);

    for (const mode of ['scoreline', 'outcome', 'sample'] as const) {
      repo.updatePrediction(prediction.id, { consensusMode: mode });
      const state = repo.buildPredictionState(prediction.id);
      expect(state.matches).toHaveLength(380);
      expect(state.matchesPlayed).toBe(380);
      expect(state.standings.every((row) => row.played === 38)).toBe(true);
    }
  });

  it('draws a coherent season in sample mode', async () => {
    const { prediction } = await seedPrediction(25);
    repo.updatePrediction(prediction.id, { consensusMode: 'sample' });

    const first = repo.buildPredictionState(prediction.id);
    repo.setActiveSample(prediction.id, 3);
    const second = repo.buildPredictionState(prediction.id);

    const scoreline = (state: typeof first) =>
      state.matches.map((m) => `${m.result.goalsHome}-${m.result.goalsAway}`).join(',');
    expect(scoreline(first)).not.toBe(scoreline(second));
  });

  it('validates the active sample index', async () => {
    const { prediction } = await seedPrediction(20);
    expect(repo.countSampledSeasons(prediction.id)).toBe(5);
    expect(() => repo.setActiveSample(prediction.id, 5)).toThrow(ValidationError);
    expect(() => repo.setActiveSample(prediction.id, -1)).toThrow(ValidationError);
  });

  it('honours locked results in the consensus season', async () => {
    repo.setActualResult(1, 6, 0);
    const { prediction } = await seedPrediction(20);
    const match = repo.buildPredictionState(prediction.id).matches.find(
      (m) => m.fixture.matchNumber === 1,
    )!;
    expect(match.result).toMatchObject({ goalsHome: 6, goalsAway: 0 });
    expect(match.locked).toBe(true);
  });

  it('records which fixtures were already locked when the batch ran', async () => {
    repo.setActualResult(1, 2, 0);
    repo.setActualResult(2, 0, 1);
    const { prediction } = await seedPrediction(20);

    expect(prediction.lockedCount).toBe(2);
    expect(prediction.asOfMatchday).toBe(1);
    expect([...repo.getPredictionLockedMatches(prediction.id)].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('deletes a prediction and its aggregates', async () => {
    const { prediction } = await seedPrediction(20);
    repo.deletePrediction(prediction.id);

    expect(() => repo.getPrediction(prediction.id)).toThrow(NotFoundError);
    for (const table of [
      'prediction_match_outcomes',
      'prediction_match_scorelines',
      'prediction_team_positions',
      'prediction_team_stats',
      'prediction_sampled_seasons',
      'prediction_locked_matches',
    ]) {
      const count = (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      expect(count).toBe(0);
    }
  });
});
