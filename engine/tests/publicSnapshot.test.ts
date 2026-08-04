import { beforeEach, describe, expect, it } from 'vitest';
import type { Repository } from '../src/db/repository.js';
import {
  buildPublicSnapshot,
  hasKickedOff,
  redactUnrevealed,
  snapshotToFiles,
} from '../src/export/publicSnapshot.js';
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

describe('hasKickedOff', () => {
  it('reveals a fixture once its kickoff has passed', () => {
    const fixture = repo.getFixtures()[0]!;
    expect(hasKickedOff(fixture, new Date('2020-01-01T00:00:00Z'))).toBe(false);
    expect(hasKickedOff(fixture, new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });
});

describe('redactUnrevealed', () => {
  it('hides predictions for fixtures that have not kicked off', async () => {
    const prediction = await seedPrediction();
    const full = repo.buildPredictionState(prediction.id);
    expect(full.matchesPlayed).toBe(380);

    const redacted = redactUnrevealed(full, new Date('2020-01-01T00:00:00Z'));
    expect(redacted.matchesPlayed).toBe(0);
    expect(redacted.matches.every((m) => m.result.goalsHome === null)).toBe(true);
    expect(redacted.standings.every((row) => row.played === 0)).toBe(true);
  });

  it('keeps everything once the season is over', async () => {
    const prediction = await seedPrediction();
    const redacted = redactUnrevealed(
      repo.buildPredictionState(prediction.id),
      new Date('2030-01-01T00:00:00Z'),
    );
    expect(redacted.matchesPlayed).toBe(380);
  });

  it('reveals only the matchdays already played', async () => {
    const prediction = await seedPrediction();
    const fixtures = repo.getFixtures();
    const matchdayTwoStart = fixtures.find((f) => f.matchday === 2)!;

    const redacted = redactUnrevealed(
      repo.buildPredictionState(prediction.id),
      new Date(`${matchdayTwoStart.date}T00:00:00Z`),
    );

    expect(redacted.matchesPlayed).toBe(10);
    const revealed = redacted.matches.filter((m) => m.result.goalsHome != null);
    expect(revealed.every((m) => m.fixture.matchday === 1)).toBe(true);
    expect(redacted.standings.every((row) => row.played === 1)).toBe(true);
  });

  it('never hides a recorded real result', async () => {
    repo.setActualResult(200, 2, 1);
    const prediction = await seedPrediction();
    const redacted = redactUnrevealed(
      repo.buildPredictionState(prediction.id),
      new Date('2020-01-01T00:00:00Z'),
    );

    const locked = redacted.matches.find((m) => m.fixture.matchNumber === 200)!;
    expect(locked.result).toMatchObject({ goalsHome: 2, goalsAway: 1 });
    expect(redacted.matchesPlayed).toBe(1);
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
    expect(snapshot.meta.revealPolicy).toBe('kickoff');
    expect(snapshot.leagueState?.matches).toHaveLength(380);
    expect(snapshot.projections?.teams).toHaveLength(20);
  });

  it('redacts the league state at export time', async () => {
    await seedPrediction();
    const snapshot = buildPublicSnapshot(repo, new Date('2020-01-01T00:00:00Z'));
    expect(snapshot.leagueState?.matchesPlayed).toBe(0);
  });

  it('writes the expected file set', async () => {
    await seedPrediction();
    const files = snapshotToFiles(buildPublicSnapshot(repo));
    expect(Object.keys(files).sort()).toEqual([
      'bootstrap.json',
      'league-state.json',
      'meta.json',
      'projections.json',
    ]);
    for (const contents of Object.values(files)) {
      expect(() => JSON.stringify(contents)).not.toThrow();
    }
  });
});
