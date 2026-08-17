import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  parseConsensusMode,
  PREDICTOR_POINTS_MAX,
  type PredictorPoints,
} from '../engine/consensus.js';
import { getDefaultFixturesCsvPath, loadFixtures } from '../data/fixturesCsv.js';
import { SEASON_ELO_DELTA_WEIGHT_MAX } from '../engine/seasonElo.js';
import { MONTE_CARLO_MAX_RUNS, runMonteCarlo } from '../simulation/monteCarlo.js';
import { SeasonRunner } from '../simulation/runner.js';
import type { Repository } from '../db/repository.js';
import { ApiError, errorBody, toApiError } from './errors.js';

function intParam(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(`${label} must be an integer`, 400);
  return parsed;
}

function numberInRange(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ApiError(`${label} must be a number between ${min} and ${max}`, 400);
  }
  return parsed;
}

interface PredictorPointsBody {
  exactScore?: number;
  correctResult?: number;
}

/**
 * Validate a predictor payoff, taking either side from `current` when the body omits it.
 *
 * An exact score paying less than a bare correct result inverts `expectedPoints` consensus — it
 * would start preferring an outcome's *least* likely scoreline — so reject rather than clamp.
 */
function validatePredictorPoints(
  body: PredictorPointsBody,
  current: PredictorPoints,
): PredictorPoints {
  const exactScore = numberInRange(
    body.exactScore ?? current.exactScore,
    'exactScore',
    0,
    PREDICTOR_POINTS_MAX,
  );
  const correctResult = numberInRange(
    body.correctResult ?? current.correctResult,
    'correctResult',
    0,
    PREDICTOR_POINTS_MAX,
  );
  if (exactScore < correctResult) {
    throw new ApiError('exactScore must be at least correctResult', 400);
  }
  return { exactScore, correctResult };
}

export function createApiApp(repo: Repository): Hono {
  const app = new Hono();
  app.use('/api/*', cors());

  app.onError((err, c) => {
    const apiError = toApiError(err);
    if (apiError.status === 500) console.error(err);
    return c.json(errorBody(err), apiError.status);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // ------------------------------------------------------- teams & fixtures

  app.get('/api/v1/teams', (c) => c.json(repo.getTeams()));

  app.put('/api/v1/teams/:id/elo', async (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const body = await c.req.json<{ elo?: number }>();
    const elo = numberInRange(body.elo, 'elo', 500, 3000);
    return c.json(repo.updateTeamElo(id, elo));
  });

  app.get('/api/v1/teams/elo-history', (c) => {
    const teamId = c.req.query('teamId');
    return c.json(repo.getEloHistory(teamId == null ? undefined : intParam(teamId, 'teamId')));
  });

  app.get('/api/v1/fixtures', (c) => c.json(repo.getFixtures()));

  app.get('/api/v1/fixtures/next-matchday', (c) =>
    c.json({ matchday: repo.getNextMatchday() }),
  );

  // -------------------------------------------------------------- settings

  app.get('/api/v1/settings/upset-variance', (c) =>
    c.json({ value: repo.getSettings().upsetVariance }),
  );

  app.put('/api/v1/settings/upset-variance', async (c) => {
    const body = await c.req.json<{ value?: number }>();
    const value = numberInRange(body.value, 'value', 0, 1);
    return c.json({ value: repo.updateSettings({ upsetVariance: value }).upsetVariance });
  });

  app.get('/api/v1/settings/season-elo-delta-weight', (c) =>
    c.json({ value: repo.getSettings().seasonEloDeltaWeight }),
  );

  app.put('/api/v1/settings/season-elo-delta-weight', async (c) => {
    const body = await c.req.json<{ value?: number }>();
    const value = numberInRange(body.value, 'value', 0, SEASON_ELO_DELTA_WEIGHT_MAX);
    return c.json({
      value: repo.updateSettings({ seasonEloDeltaWeight: value }).seasonEloDeltaWeight,
    });
  });

  app.get('/api/v1/settings/predictor-points', (c) => {
    const settings = repo.getSettings();
    return c.json({
      exactScore: settings.exactScorePoints,
      correctResult: settings.correctResultPoints,
    });
  });

  app.put('/api/v1/settings/predictor-points', async (c) => {
    const body = await c.req.json<PredictorPointsBody>();
    const current = repo.getSettings();
    const points = validatePredictorPoints(body, {
      exactScore: current.exactScorePoints,
      correctResult: current.correctResultPoints,
    });
    const updated = repo.updateSettings({
      exactScorePoints: points.exactScore,
      correctResultPoints: points.correctResult,
    });
    return c.json({
      exactScore: updated.exactScorePoints,
      correctResult: updated.correctResultPoints,
    });
  });

  // -------------------------------------------------------- actual results

  app.get('/api/v1/actual-results', (c) => c.json(repo.getActualResults()));
  app.get('/api/v1/actual-results/state', (c) => c.json(repo.buildActualResultsState()));

  app.put('/api/v1/actual-results/:matchNumber', async (c) => {
    const matchNumber = intParam(c.req.param('matchNumber'), 'matchNumber');
    const body = await c.req.json<{ goalsHome?: number; goalsAway?: number }>();
    return c.json(
      repo.setActualResult(matchNumber, Number(body.goalsHome), Number(body.goalsAway)),
    );
  });

  app.delete('/api/v1/actual-results/:matchNumber', (c) => {
    repo.clearActualResult(intParam(c.req.param('matchNumber'), 'matchNumber'));
    return c.body(null, 204);
  });

  // ----------------------------------------------------------- simulations

  app.get('/api/v1/simulations', (c) => {
    const page = Number(c.req.query('page') ?? 1);
    const pageSize = Number(c.req.query('pageSize') ?? 25);
    return c.json(repo.listSimulations(page, pageSize));
  });

  app.post('/api/v1/simulations', async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
    const name = body.name?.trim() || `Season ${new Date().toISOString().slice(0, 10)}`;
    return c.json(repo.createSimulation(name), 201);
  });

  app.get('/api/v1/simulations/:id', (c) =>
    c.json(repo.getSimulation(intParam(c.req.param('id'), 'id'))),
  );

  app.patch('/api/v1/simulations/:id', async (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const body = await c.req.json<{ name?: string }>();
    if (!body.name?.trim()) throw new ApiError('name is required', 400);
    return c.json(repo.renameSimulation(id, body.name.trim()));
  });

  app.delete('/api/v1/simulations/:id', (c) => {
    repo.deleteSimulation(intParam(c.req.param('id'), 'id'));
    return c.body(null, 204);
  });

  app.get('/api/v1/simulations/:id/state', (c) =>
    c.json(repo.buildSeasonState(intParam(c.req.param('id'), 'id'))),
  );

  app.put('/api/v1/simulations/:id/matches/:matchNumber', async (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const matchNumber = intParam(c.req.param('matchNumber'), 'matchNumber');
    const body = await c.req.json<{ goalsHome?: number; goalsAway?: number }>();
    repo.setMatchResult(id, matchNumber, Number(body.goalsHome), Number(body.goalsAway));
    return c.json(repo.buildSeasonState(id));
  });

  app.delete('/api/v1/simulations/:id/matches/:matchNumber', (c) => {
    const id = intParam(c.req.param('id'), 'id');
    repo.clearMatchResult(id, intParam(c.req.param('matchNumber'), 'matchNumber'));
    return c.json(repo.buildSeasonState(id));
  });

  app.post('/api/v1/simulations/:id/matches/:matchNumber/simulate', (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const matchNumber = intParam(c.req.param('matchNumber'), 'matchNumber');
    new SeasonRunner(repo).simulateSingleMatch(id, matchNumber);
    return c.json(repo.buildSeasonState(id));
  });

  app.post('/api/v1/simulations/:id/simulate/season', async (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const body = await c.req
      .json<{ upsetVariance?: number }>()
      .catch((): { upsetVariance?: number } => ({}));
    new SeasonRunner(repo).simulateRestOfSeason(id, {
      upsetVariance: body.upsetVariance,
    });
    return c.json(repo.buildSeasonState(id));
  });

  app.post('/api/v1/simulations/:id/simulate/matchday', async (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const body = await c.req.json<{ matchday?: number; upsetVariance?: number }>();
    const runner = new SeasonRunner(repo);
    if (body.matchday == null) runner.simulateNextMatchday(id, { upsetVariance: body.upsetVariance });
    else {
      runner.simulateUpToMatchday(id, numberInRange(body.matchday, 'matchday', 1, 38), {
        upsetVariance: body.upsetVariance,
      });
    }
    return c.json(repo.buildSeasonState(id));
  });

  // ------------------------------------------------------------ monte carlo

  app.post('/api/v1/simulate/monte-carlo', async (c) => {
    const body = await c.req.json<{ runs?: number; upsetVariance?: number; name?: string }>();
    const runs = Math.floor(numberInRange(body.runs, 'runs', 1, MONTE_CARLO_MAX_RUNS));
    const settings = repo.getSettings();
    const upsetVariance = body.upsetVariance ?? settings.upsetVariance;
    const name = body.name?.trim() || `Monte Carlo ${runs} runs`;

    const teams = repo.getTeams();
    const fixtures = repo.getFixtures();
    const lockedResults = repo.getActualResultsByMatch();

    const wantsStream = c.req.header('accept')?.includes('application/x-ndjson');

    if (!wantsStream) {
      const result = await runMonteCarlo(teams, fixtures, {
        runs,
        upsetVariance,
        eloDeltaWeight: settings.seasonEloDeltaWeight,
        lockedResults,
      });
      const prediction = repo.savePredictionFromMonteCarlo(name, result);
      return c.json({
        predictionId: prediction.id,
        runs: result.runs,
        elapsedMs: result.elapsedMs,
        teams: result.teams,
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (payload: unknown) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));

        try {
          const result = await runMonteCarlo(teams, fixtures, {
            runs,
            upsetVariance,
            eloDeltaWeight: settings.seasonEloDeltaWeight,
            lockedResults,
            onProgress: (completed, total) => {
              send({ type: 'progress', completed, total });
            },
          });
          const prediction = repo.savePredictionFromMonteCarlo(name, result);
          send({
            type: 'result',
            predictionId: prediction.id,
            runs: result.runs,
            elapsedMs: result.elapsedMs,
            teams: result.teams,
          });
        } catch (error) {
          send({ type: 'error', ...errorBody(error) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    });
  });

  // ----------------------------------------------------------- predictions

  app.get('/api/v1/predictions', (c) => {
    const page = Number(c.req.query('page') ?? 1);
    const pageSize = Number(c.req.query('pageSize') ?? 25);
    return c.json(repo.listPredictions(page, pageSize));
  });

  // Registered before /:id so the literal path is not parsed as a prediction id.
  app.get('/api/v1/predictions/accuracy-history', (c) => c.json(repo.getAccuracyHistory()));

  app.get('/api/v1/predictions/:id', (c) =>
    c.json(repo.getPrediction(intParam(c.req.param('id'), 'id'))),
  );

  app.patch('/api/v1/predictions/:id', async (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const body = await c.req.json<
      { name?: string; consensusMode?: string } & PredictorPointsBody
    >();

    // The payoff is snapshotted per batch, but consensus mode is re-selectable after the fact,
    // so its parameter has to be too — otherwise retuning would mean re-running the batch.
    const retunes = body.exactScore !== undefined || body.correctResult !== undefined;
    const current = repo.getPrediction(id);
    const points = retunes
      ? validatePredictorPoints(body, {
          exactScore: current.exactScorePoints,
          correctResult: current.correctResultPoints,
        })
      : null;

    return c.json(
      repo.updatePrediction(id, {
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.consensusMode ? { consensusMode: parseConsensusMode(body.consensusMode) } : {}),
        ...(points
          ? { exactScorePoints: points.exactScore, correctResultPoints: points.correctResult }
          : {}),
      }),
    );
  });

  app.delete('/api/v1/predictions/:id', (c) => {
    repo.deletePrediction(intParam(c.req.param('id'), 'id'));
    return c.body(null, 204);
  });

  app.get('/api/v1/predictions/:id/state', (c) =>
    c.json(repo.buildPredictionState(intParam(c.req.param('id'), 'id'))),
  );

  app.get('/api/v1/predictions/:id/projections', (c) =>
    c.json(repo.getPredictionProjections(intParam(c.req.param('id'), 'id'))),
  );

  app.get('/api/v1/predictions/:id/accuracy', (c) =>
    c.json(repo.getPredictionAccuracy(intParam(c.req.param('id'), 'id'))),
  );

  app.get('/api/v1/predictions/:id/matches/:matchNumber/distribution', (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const matchNumber = intParam(c.req.param('matchNumber'), 'matchNumber');
    return c.json(repo.getMatchDistribution(id, matchNumber));
  });

  app.get('/api/v1/predictions/:id/samples', (c) => {
    const id = intParam(c.req.param('id'), 'id');
    return c.json({ count: repo.countSampledSeasons(id) });
  });

  app.put('/api/v1/predictions/:id/active-sample', async (c) => {
    const id = intParam(c.req.param('id'), 'id');
    const body = await c.req.json<{ sampleIndex?: number }>();
    repo.setActiveSample(id, Math.floor(Number(body.sampleIndex)));
    return c.json(repo.buildPredictionState(id));
  });

  // ----------------------------------------------------------------- admin

  app.post('/api/v1/admin/regenerate-fixtures', (c) => {
    const fixtures = loadFixtures(repo.getTeams(), getDefaultFixturesCsvPath());
    return c.json({ fixtures: fixtures.length, source: getDefaultFixturesCsvPath() });
  });

  return app;
}
