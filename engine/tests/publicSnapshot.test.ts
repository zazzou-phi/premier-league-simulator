import { beforeEach, describe, expect, it } from 'vitest';
import type { Repository } from '../src/db/repository.js';
import { buildPublicSnapshot, snapshotToFiles } from '../src/export/publicSnapshot.js';
import { runMonteCarlo } from '../src/simulation/monteCarlo.js';
import { createTestRepository } from './testDb.js';
import { testRng } from './testRng.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

async function seedPrediction(runs = 20) {
  const result = await runMonteCarlo(repo.getTeams(), repo.getFixtures(), {
    runs,
    rng: testRng(41),
    reservoirSize: 3,
  });
  return repo.savePredictionFromMonteCarlo('Public batch', result);
}

describe('published season', () => {
  it('publishes every fixture, whenever it is exported', async () => {
    const prediction = await seedPrediction();
    const full = repo.buildPredictionState(prediction.id);
    expect(full.matchesPlayed).toBe(380);

    // Long before any kickoff. The snapshot is general interest, not a contest, so the whole
    // season goes out — nothing is held back for a later export.
    const snapshot = buildPublicSnapshot(repo, new Date('2020-01-01T00:00:00Z'));

    expect(snapshot.leagueState?.matches).toEqual(full.matches);
    expect(snapshot.leagueState?.matchesPlayed).toBe(380);
    expect(snapshot.meta.revealPolicy).toBe('full');
  });

  it('publishes recorded results alongside the picks that fill the rest', async () => {
    for (const fixture of repo.getFixtures().filter((f) => f.matchday === 1)) {
      repo.setActualResult(fixture.matchNumber, 1, 0);
    }
    await seedPrediction();

    const snapshot = buildPublicSnapshot(repo, new Date('2020-01-01T00:00:00Z'));
    const matches = snapshot.leagueState!.matches;

    expect(matches.filter((m) => m.locked)).toHaveLength(10);
    expect(matches.every((m) => m.result.goalsHome != null)).toBe(true);
  });
});

describe('buildPublicSnapshot', () => {
  it('includes bootstrap data even with no prediction', () => {
    const snapshot = buildPublicSnapshot(repo);
    expect(snapshot.bootstrap.teams).toHaveLength(20);
    expect(snapshot.bootstrap.fixtures).toHaveLength(380);
    expect(snapshot.leagueState).toBeNull();
    expect(snapshot.projections).toBeNull();
    expect(snapshot.meta.predictionId).toBeNull();
  });

  it('exports the active prediction', async () => {
    const prediction = await seedPrediction(15);
    const snapshot = buildPublicSnapshot(repo, new Date('2030-01-01T00:00:00Z'));

    expect(snapshot.meta.predictionId).toBe(prediction.id);
    expect(snapshot.meta.predictionName).toBe('Public batch');
    expect(snapshot.meta.runs).toBe(15);
    expect(snapshot.meta.asOfMatchday).toBe(1);
    expect(snapshot.bootstrap.eloHistory).toEqual([]);
    expect(snapshot.meta.revealPolicy).toBe('full');
    expect(snapshot.leagueState?.matches).toHaveLength(380);
    expect(snapshot.projections?.teams).toHaveLength(20);
  });

  it('exports the state the private app would build, unmodified', async () => {
    const prediction = await seedPrediction();
    const snapshot = buildPublicSnapshot(repo, new Date('2020-01-01T00:00:00Z'));
    expect(snapshot.leagueState).toEqual(repo.buildPredictionState(prediction.id));
  });

  it('exports a distribution for every fixture, in match order', async () => {
    await seedPrediction();
    const snapshot = buildPublicSnapshot(repo, new Date('2020-01-01T00:00:00Z'));

    const numbers = snapshot.distributions.map((d) => d.matchNumber);
    expect(numbers).toHaveLength(380);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));

    // The spread behind a shown pick, not a bare count.
    const first = snapshot.distributions[0]!;
    expect(first.outcomes.homeWin + first.outcomes.draw + first.outcomes.awayWin).toBe(20);
    expect(first.scorelines.length).toBeGreaterThan(0);
  });

  it('writes the expected file set', async () => {
    await seedPrediction();
    const files = snapshotToFiles(buildPublicSnapshot(repo));
    expect(Object.keys(files).sort()).toEqual([
      'bootstrap.json',
      'distributions.json',
      'league-state.json',
      'meta.json',
      'projections.json',
      'season-projections.json',
    ]);
    for (const contents of Object.values(files)) {
      expect(() => JSON.stringify(contents)).not.toThrow();
    }
  });
});
