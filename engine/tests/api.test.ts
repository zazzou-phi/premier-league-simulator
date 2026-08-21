import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/api/app.js';
import type { Repository } from '../src/db/repository.js';
import { DEFAULT_UPSET_VARIANCE } from '../src/engine/matchSimulator.js';
import type { SeasonState, Team } from '../src/engine/types.js';
import { createTestRepository } from './testDb.js';

let repo: Repository;
let app: Hono;

beforeEach(() => {
  ({ repo } = createTestRepository());
  app = createApiApp(repo);
});

const json = (path: string, init?: RequestInit) => app.request(path, init);

function post(path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function put(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('health and reference data', () => {
  it('reports healthy', async () => {
    const res = await json('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('lists teams and fixtures', async () => {
    const teams = (await (await json('/api/v1/teams')).json()) as Team[];
    expect(teams).toHaveLength(20);
    expect(teams[0]).toHaveProperty('shortName');
    expect(teams[0]).toHaveProperty('elo');
    expect(teams[0]).not.toHaveProperty('offensiveRating');

    const fixtures = (await (await json('/api/v1/fixtures')).json()) as unknown[];
    expect(fixtures).toHaveLength(380);
  });

  it('reports the next unplayed matchday', async () => {
    expect(await (await json('/api/v1/fixtures/next-matchday')).json()).toEqual({ matchday: 1 });

    for (const fixture of repo.getFixtures().filter((f) => f.matchday === 1)) {
      repo.setActualResult(fixture.matchNumber, 1, 0);
    }
    expect(await (await json('/api/v1/fixtures/next-matchday')).json()).toEqual({ matchday: 2 });
  });

  it('serves dated Elo history', async () => {
    expect(await (await json('/api/v1/teams/elo-history')).json()).toEqual([]);

    repo.recordEloSnapshot('2026-09-05', [
      { teamId: 1, elo: 2000 },
      { teamId: 2, elo: 1900 },
    ]);
    repo.recordEloSnapshot('2026-09-12', [{ teamId: 1, elo: 2020 }]);

    const all = (await (await json('/api/v1/teams/elo-history')).json()) as unknown[];
    expect(all).toHaveLength(3);

    const one = (await (await json('/api/v1/teams/elo-history?teamId=1')).json()) as Array<{
      asOf: string;
      elo: number;
    }>;
    expect(one.map((row) => row.elo)).toEqual([2000, 2020]);
  });

  it('updates a team Elo', async () => {
    const res = await put('/api/v1/teams/1/elo', { elo: 2100 });
    expect(res.status).toBe(200);
    expect((await res.json()).elo).toBe(2100);
  });

  it('rejects an out-of-range Elo', async () => {
    expect((await put('/api/v1/teams/1/elo', { elo: 99_999 })).status).toBe(400);
  });

  it('404s an unknown team', async () => {
    expect((await put('/api/v1/teams/999/elo', { elo: 1800 })).status).toBe(404);
  });
});

describe('settings', () => {
  it('round-trips upset variance', async () => {
    expect((await (await json('/api/v1/settings/upset-variance')).json()).value).toBeCloseTo(
      DEFAULT_UPSET_VARIANCE,
      6,
    );
    const res = await put('/api/v1/settings/upset-variance', { value: 0.4 });
    expect((await res.json()).value).toBeCloseTo(0.4, 6);
  });

  it('validates ranges', async () => {
    expect((await put('/api/v1/settings/upset-variance', { value: 5 })).status).toBe(400);
    expect((await put('/api/v1/settings/season-elo-delta-weight', { value: -1 })).status).toBe(400);
  });

  // The predictor payoff was withdrawn along with the strategy it drove.
  it('no longer serves the predictor payoff', async () => {
    expect((await json('/api/v1/settings/scoring-rules')).status).toBe(404);
    expect((await put('/api/v1/settings/scoring-rules', { exactScore: 5 })).status).toBe(404);
  });
});

describe('simulations', () => {
  async function createSimulation(name = 'Test'): Promise<number> {
    const res = await post('/api/v1/simulations', { name });
    expect(res.status).toBe(201);
    return (await res.json()).id as number;
  }

  it('creates, fetches, renames and deletes', async () => {
    const id = await createSimulation('Original');
    expect((await (await json(`/api/v1/simulations/${id}`)).json()).name).toBe('Original');

    const renamed = await app.request(`/api/v1/simulations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect((await renamed.json()).name).toBe('Renamed');

    expect((await app.request(`/api/v1/simulations/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await json(`/api/v1/simulations/${id}`)).status).toBe(404);
  });

  it('rejects an empty rename', async () => {
    const id = await createSimulation();
    const res = await app.request(`/api/v1/simulations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns a full season state', async () => {
    const id = await createSimulation();
    const state = (await (await json(`/api/v1/simulations/${id}/state`)).json()) as SeasonState;
    expect(state.matchesTotal).toBe(380);
    expect(state.matchesPlayed).toBe(0);
    expect(state.standings).toHaveLength(20);
    expect(state.matches[0]).toHaveProperty('teamHome');
  });

  it('sets and clears a score', async () => {
    const id = await createSimulation();
    const afterSet = (await (await put(`/api/v1/simulations/${id}/matches/1`, {
      goalsHome: 2,
      goalsAway: 1,
    })).json()) as SeasonState;
    expect(afterSet.matchesPlayed).toBe(1);

    const afterClear = (await (
      await app.request(`/api/v1/simulations/${id}/matches/1`, { method: 'DELETE' })
    ).json()) as SeasonState;
    expect(afterClear.matchesPlayed).toBe(0);
  });

  it('rejects an invalid score', async () => {
    const id = await createSimulation();
    expect((await put(`/api/v1/simulations/${id}/matches/1`, { goalsHome: -1, goalsAway: 0 })).status).toBe(400);
  });

  it('simulates one match, one matchday, and the rest of the season', async () => {
    const id = await createSimulation();

    const single = (await (await post(`/api/v1/simulations/${id}/matches/1/simulate`)).json()) as SeasonState;
    expect(single.matchesPlayed).toBe(1);

    const matchday = (await (await post(`/api/v1/simulations/${id}/simulate/matchday`, {})).json()) as SeasonState;
    expect(matchday.matchesPlayed).toBe(10);

    const season = (await (await post(`/api/v1/simulations/${id}/simulate/season`, {})).json()) as SeasonState;
    expect(season.matchesPlayed).toBe(380);
    expect(season.standings.every((row) => row.played === 38)).toBe(true);
  });

  it('simulates up to a chosen matchday', async () => {
    const id = await createSimulation();
    const res = await post(`/api/v1/simulations/${id}/simulate/matchday`, { matchday: 10 });
    expect(((await res.json()) as SeasonState).matchesPlayed).toBe(100);
  });

  it('rejects an out-of-range matchday', async () => {
    const id = await createSimulation();
    expect((await post(`/api/v1/simulations/${id}/simulate/matchday`, { matchday: 99 })).status).toBe(400);
  });

  it('paginates', async () => {
    for (let i = 0; i < 3; i++) await createSimulation(`Sim ${i}`);
    const page = await (await json('/api/v1/simulations?page=1&pageSize=2')).json();
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
  });
});

describe('actual results', () => {
  it('records, lists and clears', async () => {
    expect((await put('/api/v1/actual-results/1', { goalsHome: 3, goalsAway: 0 })).status).toBe(200);

    const list = (await (await json('/api/v1/actual-results')).json()) as unknown[];
    expect(list).toHaveLength(1);

    const state = (await (await json('/api/v1/actual-results/state')).json()) as SeasonState;
    expect(state.matchesPlayed).toBe(1);

    expect((await app.request('/api/v1/actual-results/1', { method: 'DELETE' })).status).toBe(204);
    expect((await (await json('/api/v1/actual-results')).json()) as unknown[]).toHaveLength(0);
  });

  it('409s when a simulation touches a locked match', async () => {
    const id = (await (await post('/api/v1/simulations', { name: 'S' })).json()).id as number;
    await put('/api/v1/actual-results/1', { goalsHome: 1, goalsAway: 1 });

    const res = await put(`/api/v1/simulations/${id}/matches/1`, { goalsHome: 5, goalsAway: 0 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('MATCH_LOCKED');
  });

  it('404s an unknown fixture', async () => {
    expect((await put('/api/v1/actual-results/9999', { goalsHome: 1, goalsAway: 0 })).status).toBe(404);
  });
});

describe('monte carlo and predictions', () => {
  it('runs a batch and stores it as a prediction', async () => {
    const res = await post('/api/v1/simulate/monte-carlo', { runs: 15, name: 'Batch' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.runs).toBe(15);
    expect(body.teams).toHaveLength(20);
    expect(body.predictionId).toBeGreaterThan(0);

    const titleSum = body.teams.reduce(
      (sum: number, team: { titleProbability: number }) => sum + team.titleProbability,
      0,
    );
    expect(titleSum).toBeCloseTo(1, 6);
  });

  it('validates the run count', async () => {
    expect((await post('/api/v1/simulate/monte-carlo', { runs: 0 })).status).toBe(400);
    expect((await post('/api/v1/simulate/monte-carlo', { runs: 1_000_000 })).status).toBe(400);
  });

  it('streams progress as NDJSON', async () => {
    const res = await app.request('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({ runs: 10 }),
    });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const lines = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.filter((l) => l.type === 'progress').length).toBeGreaterThan(0);

    const final = lines.at(-1);
    expect(final.type).toBe('result');
    expect(final.runs).toBe(10);
    expect(final.teams).toHaveLength(20);
  });

  it('exposes projections, state and distributions', async () => {
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 12 })).json();

    const projections = await (await json(`/api/v1/predictions/${predictionId}/projections`)).json();
    expect(projections.runs).toBe(12);
    expect(projections.teams).toHaveLength(20);

    const state = (await (await json(`/api/v1/predictions/${predictionId}/state`)).json()) as SeasonState;
    expect(state.matches).toHaveLength(380);
    expect(state.standings.every((row) => row.played === 38)).toBe(true);

    const distribution = await (
      await json(`/api/v1/predictions/${predictionId}/matches/1/distribution`)
    ).json();
    expect(distribution.outcomes.total).toBe(12);
  });

  it('grades a prediction against results recorded after it ran', async () => {
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 50 })).json();

    const before = await (await json(`/api/v1/predictions/${predictionId}/accuracy`)).json();
    expect(before.graded).toBe(0);
    expect(before.pending).toBe(380);
    expect(before.asOfMatchday).toBe(1);

    await put('/api/v1/actual-results/1', { goalsHome: 2, goalsAway: 1 });

    const after = await (await json(`/api/v1/predictions/${predictionId}/accuracy`)).json();
    expect(after.graded).toBe(1);
    expect(after.skippedLocked).toBe(0);
    expect(after.matches[0]).toMatchObject({ matchNumber: 1, actualOutcome: 'homeWin' });
    expect(after.brierScore).toBeGreaterThanOrEqual(0);
  });

  it('excludes fixtures the batch already knew from its grade', async () => {
    await put('/api/v1/actual-results/1', { goalsHome: 4, goalsAway: 0 });
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 50 })).json();

    const accuracy = await (await json(`/api/v1/predictions/${predictionId}/accuracy`)).json();
    expect(accuracy.graded).toBe(0);
    expect(accuracy.skippedLocked).toBe(1);
    expect(accuracy.asOfMatchday).toBe(1);
  });

  it('trends accuracy across projections without colliding with the :id route', async () => {
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 50 })).json();

    // The literal path must not be parsed as a prediction id.
    const empty = await json('/api/v1/predictions/accuracy-history');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    await put('/api/v1/actual-results/1', { goalsHome: 2, goalsAway: 1 });

    const history = (await (await json('/api/v1/predictions/accuracy-history')).json()) as Array<{
      predictionId: number;
      graded: number;
      asOfMatchday: number | null;
    }>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ predictionId, graded: 1, asOfMatchday: 1 });
  });

  it('404s accuracy for an unknown prediction', async () => {
    expect((await json('/api/v1/predictions/999/accuracy')).status).toBe(404);
  });

  it('changes pick strategy', async () => {
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 12 })).json();
    const res = await app.request(`/api/v1/predictions/${predictionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pickStrategy: 'random', name: 'Renamed' }),
    });
    const body = await res.json();
    expect(body.pickStrategy).toBe('random');
    expect(body.name).toBe('Renamed');
  });

  it('ignores a payoff sent by an old client, and carries no payoff back', async () => {
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 12 })).json();
    const res = await app.request(`/api/v1/predictions/${predictionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pickStrategy: 'calibrated', exactScore: 7 }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pickStrategy).toBe('calibrated');
    expect(body).not.toHaveProperty('exactScorePoints');
    expect(body).not.toHaveProperty('correctResultPoints');
  });

  it('selects a sampled season', async () => {
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 12 })).json();
    const samples = await (await json(`/api/v1/predictions/${predictionId}/samples`)).json();
    expect(samples.count).toBeGreaterThan(0);

    expect((await put(`/api/v1/predictions/${predictionId}/active-sample`, { sampleIndex: 1 })).status).toBe(200);
    expect((await put(`/api/v1/predictions/${predictionId}/active-sample`, { sampleIndex: 999 })).status).toBe(400);
  });

  it('lists and deletes predictions', async () => {
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 10 })).json();
    const list = await (await json('/api/v1/predictions')).json();
    expect(list.total).toBe(1);

    expect((await app.request(`/api/v1/predictions/${predictionId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await json(`/api/v1/predictions/${predictionId}`)).status).toBe(404);
  });

  it('respects locked results across the batch', async () => {
    await put('/api/v1/actual-results/1', { goalsHome: 4, goalsAway: 4 });
    const { predictionId } = await (await post('/api/v1/simulate/monte-carlo', { runs: 10 })).json();

    const distribution = await (
      await json(`/api/v1/predictions/${predictionId}/matches/1/distribution`)
    ).json();
    expect(distribution.outcomes.draw).toBe(10);
  });
});

describe('error handling', () => {
  it('404s unknown routes', async () => {
    expect((await json('/api/v1/nope')).status).toBe(404);
  });

  it('400s a non-integer path parameter', async () => {
    expect((await json('/api/v1/simulations/abc')).status).toBe(400);
  });

  it('returns a structured error body', async () => {
    const body = await (await json('/api/v1/simulations/999999')).json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code', 'NOT_FOUND');
  });
});
