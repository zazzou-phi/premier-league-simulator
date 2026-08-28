import { beforeEach, describe, expect, it } from 'vitest';
import type { Prediction, Repository } from '../src/db/repository.js';
import { NotFoundError } from '../src/db/errors.js';
import { buildPublicSnapshot } from '../src/export/publicSnapshot.js';
import { runMonteCarlo } from '../src/simulation/monteCarlo.js';
import { createTestRepository } from './testDb.js';
import { testRng } from './testRng.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

async function project(name: string, runs = 60): Promise<Prediction> {
  const result = await runMonteCarlo(repo.getTeams(), repo.getFixtures(), {
    runs,
    rng: testRng(),
    reservoirSize: 3,
    lockedResults: repo.getActualResultsByMatch(),
  });
  return repo.savePredictionFromMonteCarlo(name, result);
}

/** Record every fixture in a round, so the next batch is handed it rather than forecasting it. */
function playMatchday(matchday: number): number[] {
  const fixtures = repo.getFixtures().filter((fixture) => fixture.matchday === matchday);
  fixtures.forEach((fixture, index) => {
    repo.setActualResult(fixture.matchNumber, (index % 3) + 1, index % 2);
  });
  return fixtures.map((fixture) => fixture.matchNumber);
}

/** Project blind, play matchday 1, project again — the shape of one turn of the weekly loop. */
async function playFirstMatchday() {
  const blind = await project('MD1 blind');
  const matchday1 = playMatchday(1);
  const informed = await project('MD2 informed');
  return { blind, informed, matchday1 };
}

describe('resolveMatchdayProjections', () => {
  it('has nothing to attach before any batch has run', () => {
    const resolved = repo.resolveMatchdayProjections();
    expect(resolved).toHaveLength(38);
    expect(resolved.every((entry) => entry.predictionId === null)).toBe(true);
  });

  it('attaches every matchday to the only batch there is', async () => {
    const only = await project('Pre-season');
    const resolved = repo.resolveMatchdayProjections();

    expect(resolved.every((entry) => entry.predictionId === only.id)).toBe(true);
    expect(resolved.every((entry) => entry.forecast)).toBe(true);
    expect(resolved.every((entry) => !entry.pinned)).toBe(true);
  });

  it('keeps a played round on the batch that forecast it, not the newest one', async () => {
    const { blind, informed } = await playFirstMatchday();
    const byMatchday = new Map(
      repo.resolveMatchdayProjections().map((entry) => [entry.matchday, entry]),
    );

    // The newest batch was handed matchday 1, so it has no forecast to show for it.
    expect(byMatchday.get(1)?.predictionId).toBe(blind.id);
    expect(byMatchday.get(1)?.forecast).toBe(true);
    expect(byMatchday.get(2)?.predictionId).toBe(informed.id);
    expect(byMatchday.get(38)?.predictionId).toBe(informed.id);
  });

  it('follows the season: each round keeps the last batch that faced it blind', async () => {
    const first = await project('Before MD1');
    playMatchday(1);
    const second = await project('Before MD2');
    playMatchday(2);
    const third = await project('Before MD3');

    const byMatchday = new Map(
      repo.resolveMatchdayProjections().map((entry) => [entry.matchday, entry.predictionId]),
    );
    expect(byMatchday.get(1)).toBe(first.id);
    expect(byMatchday.get(2)).toBe(second.id);
    expect(byMatchday.get(3)).toBe(third.id);
  });
});

describe('pinning a matchday', () => {
  it('overrides the default rule and says so', async () => {
    const { blind, informed } = await playFirstMatchday();

    const pinned = repo.pinMatchdayProjection(1, informed.id);
    expect(pinned).toMatchObject({ matchday: 1, predictionId: informed.id, pinned: true });
    // The pinned batch was handed this round, which the flag reports rather than hides.
    expect(pinned.forecast).toBe(false);

    expect(repo.getMatchdayProjection(1).predictionId).toBe(informed.id);
    expect(repo.clearMatchdayProjection(1)).toMatchObject({
      predictionId: blind.id,
      pinned: false,
    });
  });

  it('rejects a matchday or a batch that does not exist', async () => {
    const prediction = await project('Only batch');
    expect(() => repo.pinMatchdayProjection(39, prediction.id)).toThrow(NotFoundError);
    expect(() => repo.pinMatchdayProjection(1, prediction.id + 99)).toThrow(NotFoundError);
    expect(() => repo.getMatchdayProjection(0)).toThrow(NotFoundError);
  });

  it('releases a pin when the batch behind it is deleted', async () => {
    const { blind, informed } = await playFirstMatchday();
    repo.pinMatchdayProjection(5, blind.id);

    repo.deletePrediction(blind.id);

    expect(repo.getPinnedMatchdayProjections().size).toBe(0);
    expect(repo.getMatchdayProjection(5).predictionId).toBe(informed.id);
  });

  it('flags which batches actually forecast a round', async () => {
    const { blind, informed } = await playFirstMatchday();

    const forMatchday1 = new Map(
      repo.listMatchdayProjectionCandidates(1).map((item) => [item.id, item.forecast]),
    );
    expect(forMatchday1.get(blind.id)).toBe(true);
    expect(forMatchday1.get(informed.id)).toBe(false);

    const forMatchday2 = new Map(
      repo.listMatchdayProjectionCandidates(2).map((item) => [item.id, item.forecast]),
    );
    expect(forMatchday2.get(blind.id)).toBe(true);
    expect(forMatchday2.get(informed.id)).toBe(true);
  });
});

describe('buildAssignedSeasonState', () => {
  it("is the single batch's own state when there is only one", async () => {
    const only = await project('Pre-season');
    expect(repo.buildAssignedSeasonState()).toEqual(repo.buildPredictionState(only.id));
  });

  it('falls back to the recorded results with no batch at all', () => {
    playMatchday(1);
    expect(repo.buildAssignedSeasonState()).toEqual(repo.buildActualResultsState());
  });

  it('keeps the pick a played round was faced with, beside the result', async () => {
    const { blind, matchday1 } = await playFirstMatchday();

    const composed = repo.buildAssignedSeasonState();
    const played = composed.matches.filter((match) => matchday1.includes(match.fixture.matchNumber));
    expect(played).toHaveLength(10);
    expect(played.every((match) => match.locked)).toBe(true);
    // The newest batch was handed these, so reading the season through it alone loses the picks.
    expect(played.every((match) => match.pick != null)).toBe(true);

    const flattened = repo.buildPredictionState(repo.getActivePrediction()!.id);
    const lost = flattened.matches.filter((match) => matchday1.includes(match.fixture.matchNumber));
    expect(lost.every((match) => match.pick == null)).toBe(true);

    // Those picks are the blind batch's own, unchanged.
    const blindState = repo.buildPredictionState(blind.id);
    const blindPicks = new Map(
      blindState.matches.map((match) => [match.fixture.matchNumber, match.pick]),
    );
    for (const match of played) {
      expect(match.pick).toEqual(blindPicks.get(match.fixture.matchNumber));
    }
  });

  it('takes a pinned round from the batch it is pinned to', async () => {
    const { blind, informed } = await playFirstMatchday();
    repo.pinMatchdayProjection(5, blind.id);

    const composed = repo.buildAssignedSeasonState();
    const blindPicks = new Map(
      repo.buildPredictionState(blind.id).matches.map((m) => [m.fixture.matchNumber, m.pick]),
    );
    const informedPicks = new Map(
      repo.buildPredictionState(informed.id).matches.map((m) => [m.fixture.matchNumber, m.pick]),
    );

    for (const match of composed.matches) {
      const expected =
        match.fixture.matchday === 5 || match.fixture.matchday === 1 ? blindPicks : informedPicks;
      expect(match.pick).toEqual(expected.get(match.fixture.matchNumber));
    }
  });

  it('names the active batch, so the header and the season agree', async () => {
    const { informed } = await playFirstMatchday();
    expect(repo.buildAssignedSeasonState().simulationId).toBe(informed.id);
  });
});

describe('assigned distributions', () => {
  it("takes each fixture's spread from the batch that supplied its pick", async () => {
    const { blind, informed, matchday1 } = await playFirstMatchday();

    const assigned = new Map(
      repo.getAssignedDistributions().map((entry) => [entry.matchNumber, entry]),
    );
    expect(assigned.size).toBe(380);

    const blindDistributions = repo.getPredictionDistributions(blind.id);
    const informedDistributions = repo.getPredictionDistributions(informed.id);

    for (const matchNumber of matchday1) {
      expect(assigned.get(matchNumber)).toEqual(blindDistributions.get(matchNumber));
    }
    const later = repo.getFixtures().find((fixture) => fixture.matchday === 2)!.matchNumber;
    expect(assigned.get(later)).toEqual(informedDistributions.get(later));
  });
});

describe('public snapshot', () => {
  it('publishes what each matchday is attached to', async () => {
    const { blind, informed } = await playFirstMatchday();
    const snapshot = buildPublicSnapshot(repo, new Date('2026-01-01T00:00:00Z'));

    expect(snapshot.meta.matchdays).toHaveLength(38);
    expect(snapshot.meta.matchdays[0]).toMatchObject({
      matchday: 1,
      predictionId: blind.id,
      name: 'MD1 blind',
    });
    // `predictionId` still names the active batch: it is what the season-wide odds come from.
    expect(snapshot.meta.predictionId).toBe(informed.id);
  });

  it('exports the composed season and its matching spreads', async () => {
    await playFirstMatchday();
    const snapshot = buildPublicSnapshot(repo, new Date('2026-01-01T00:00:00Z'));

    expect(snapshot.leagueState).toEqual(repo.buildAssignedSeasonState());
    expect(snapshot.distributions).toEqual(repo.getAssignedDistributions());
    expect(snapshot.distributions).toHaveLength(380);
  });
});
