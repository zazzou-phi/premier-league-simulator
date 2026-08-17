import { beforeEach, describe, expect, it } from 'vitest';
import {
  brierScore,
  buildCalibration,
  gradePrediction,
  logLoss,
  UNIFORM_BRIER,
  type MatchAccuracy,
} from '../src/engine/accuracy.js';
import type { Repository } from '../src/db/repository.js';
import { formatAccuracyReport, pickGradeablePrediction } from '../src/scoring/report.js';
import { runMonteCarlo } from '../src/simulation/monteCarlo.js';
import { createTestRepository } from './testDb.js';
import { testRng } from './testRng.js';

let repo: Repository;

beforeEach(() => {
  ({ repo } = createTestRepository());
});

describe('brierScore', () => {
  it('is 0 for a confident correct call', () => {
    expect(brierScore({ homeWin: 1, draw: 0, awayWin: 0 }, 'homeWin')).toBe(0);
  });

  it('is 2 for a confident wrong call', () => {
    expect(brierScore({ homeWin: 1, draw: 0, awayWin: 0 }, 'awayWin')).toBe(2);
  });

  it('is 2/3 for a uniform guess, whatever happens', () => {
    const uniform = { homeWin: 1 / 3, draw: 1 / 3, awayWin: 1 / 3 };
    for (const outcome of ['homeWin', 'draw', 'awayWin'] as const) {
      expect(brierScore(uniform, outcome)).toBeCloseTo(UNIFORM_BRIER, 10);
    }
  });

  it('rewards leaning the right way', () => {
    const leaning = { homeWin: 0.6, draw: 0.25, awayWin: 0.15 };
    expect(brierScore(leaning, 'homeWin')).toBeLessThan(UNIFORM_BRIER);
    expect(brierScore(leaning, 'awayWin')).toBeGreaterThan(UNIFORM_BRIER);
  });
});

describe('logLoss', () => {
  it('is 0 when the actual outcome was certain', () => {
    expect(logLoss({ homeWin: 1, draw: 0, awayWin: 0 }, 'homeWin', 1000)).toBe(0);
  });

  it('is ln 3 for a uniform guess', () => {
    expect(logLoss({ homeWin: 1 / 3, draw: 1 / 3, awayWin: 1 / 3 }, 'draw', 1000)).toBeCloseTo(
      Math.log(3),
      10,
    );
  });

  it('floors a zero-probability outcome at half a run rather than diverging', () => {
    const loss = logLoss({ homeWin: 1, draw: 0, awayWin: 0 }, 'draw', 500);
    expect(Number.isFinite(loss)).toBe(true);
    expect(loss).toBeCloseTo(Math.log(1000), 10);
  });
});

describe('buildCalibration', () => {
  it('pairs predicted probability with observed frequency per bucket', () => {
    // Ten matches all called 90/5/5 for the home side; nine of them finish that way.
    const matches = Array.from({ length: 10 }, (_, index) => ({
      probabilities: { homeWin: 0.9, draw: 0.05, awayWin: 0.05 },
      actualOutcome: index === 0 ? 'draw' : 'homeWin',
    })) as MatchAccuracy[];

    const bins = buildCalibration(matches);
    const top = bins.find((bin) => bin.lowerEdge === 0.9)!;
    expect(top.count).toBe(10);
    expect(top.meanPredicted).toBeCloseTo(0.9, 10);
    expect(top.observedRate).toBeCloseTo(0.9, 10);

    const bottom = bins.find((bin) => bin.lowerEdge === 0)!;
    expect(bottom.count).toBe(20);
    expect(bottom.observedRate).toBeCloseTo(0.05, 10);
  });
});

describe('gradePrediction', () => {
  const fixture = {
    matchNumber: 1,
    matchday: 1,
    date: '2026-08-15',
    time: '15:00',
    teamHomeId: 1,
    teamAwayId: 2,
  };
  const teamsById = new Map([
    [1, { id: 1, name: 'Home', shortName: 'HOM', crest: null, elo: 1900 }],
    [2, { id: 2, name: 'Away', shortName: 'AWY', crest: null, elo: 1800 }],
  ]);
  const distribution = {
    outcomes: { homeWin: 60, draw: 25, awayWin: 15, total: 100 },
    scorelines: [
      { goalsHome: 2, goalsAway: 1, n: 40 },
      { goalsHome: 1, goalsAway: 1, n: 25 },
      { goalsHome: 1, goalsAway: 0, n: 20 },
      { goalsHome: 0, goalsAway: 1, n: 15 },
    ],
  };

  const grade = (
    actual: { goalsHome: number; goalsAway: number } | null,
    locked = new Set<number>(),
  ) =>
    gradePrediction(
      {
        pickStrategy: 'likeliestScore',
        fixtures: [fixture],
        teamsById,
        distributions: new Map([[1, distribution]]),
        actuals: actual ? new Map([[1, actual]]) : new Map(),
        lockedAtRunTime: locked,
      },
      100,
    );

  it('scores an exact hit as both an outcome and a scoreline hit', () => {
    const report = grade({ goalsHome: 2, goalsAway: 1 });
    expect(report.graded).toBe(1);
    expect(report.outcomeHitRate).toBe(1);
    expect(report.scorelineHitRate).toBe(1);
    expect(report.matches[0]!.scorelineProbability).toBeCloseTo(0.4, 10);
    expect(report.brierScore).toBeCloseTo(brierScore({ homeWin: 0.6, draw: 0.25, awayWin: 0.15 }, 'homeWin'), 10);
  });

  it('counts the right outcome with the wrong scoreline as an outcome hit only', () => {
    const report = grade({ goalsHome: 3, goalsAway: 0 });
    expect(report.outcomeHitRate).toBe(1);
    expect(report.scorelineHitRate).toBe(0);
    // A scoreline the batch never produced still gets a real probability of zero.
    expect(report.matches[0]!.scorelineProbability).toBe(0);
  });

  it('reports positive skill when it leaned the right way', () => {
    expect(grade({ goalsHome: 2, goalsAway: 1 }).skillScore).toBeGreaterThan(0);
    expect(grade({ goalsHome: 0, goalsAway: 1 }).skillScore).toBeLessThan(0);
  });

  it('excludes fixtures that were already locked when the batch ran', () => {
    const report = grade({ goalsHome: 2, goalsAway: 1 }, new Set([1]));
    expect(report.graded).toBe(0);
    expect(report.skippedLocked).toBe(1);
    expect(report.matches).toHaveLength(0);
  });

  it('counts a fixture with no result as pending, not as a miss', () => {
    const report = grade(null);
    expect(report.graded).toBe(0);
    expect(report.pending).toBe(1);
    expect(report.outcomeHitRate).toBe(0);
  });
});

describe('repository grading', () => {
  /** Project blind, play matchday 1 for real, project again. */
  async function playFirstMatchday() {
    const first = await runMonteCarlo(repo.getTeams(), repo.getFixtures(), {
      runs: 200,
      rng: testRng(),
    });
    const blind = repo.savePredictionFromMonteCarlo('MD1 blind', first);

    const matchday1 = repo.getFixtures().filter((fixture) => fixture.matchday === 1);
    matchday1.forEach((fixture, index) => {
      repo.setActualResult(fixture.matchNumber, (index % 3) + 1, index % 2);
    });

    const second = await runMonteCarlo(repo.getTeams(), repo.getFixtures(), {
      runs: 200,
      rng: testRng(),
      lockedResults: repo.getActualResultsByMatch(),
    });
    const informed = repo.savePredictionFromMonteCarlo('MD2 informed', second);

    return { blind, informed, matchday1 };
  }

  it('records provenance when a batch is saved', async () => {
    const { blind, informed, matchday1 } = await playFirstMatchday();

    expect(blind.asOfMatchday).toBe(1);
    expect(blind.lockedCount).toBe(0);
    expect(repo.getPredictionLockedMatches(blind.id).size).toBe(0);

    expect(informed.asOfMatchday).toBe(2);
    expect(informed.lockedCount).toBe(matchday1.length);
    expect(repo.getPredictionLockedMatches(informed.id).size).toBe(matchday1.length);
  });

  it('grades the blind batch and finds nothing to grade in the informed one', async () => {
    const { blind, informed, matchday1 } = await playFirstMatchday();

    const blindReport = repo.getPredictionAccuracy(blind.id);
    expect(blindReport.graded).toBe(matchday1.length);
    expect(blindReport.skippedLocked).toBe(0);
    expect(blindReport.byMatchday).toEqual([
      expect.objectContaining({ matchday: 1, graded: matchday1.length }),
    ]);
    expect(blindReport.brierScore).toBeGreaterThan(0);
    expect(blindReport.brierScore).toBeLessThanOrEqual(2);

    const informedReport = repo.getPredictionAccuracy(informed.id);
    expect(informedReport.graded).toBe(0);
    expect(informedReport.skippedLocked).toBe(matchday1.length);
  });

  it('never grades a batch on results it was handed', async () => {
    const { informed } = await playFirstMatchday();
    const locked = repo.getPredictionLockedMatches(informed.id);
    const report = repo.getPredictionAccuracy(informed.id);
    expect(report.matches.every((match) => !locked.has(match.matchNumber))).toBe(true);
  });

  it('picks the most recent batch that has something to grade', async () => {
    const { blind } = await playFirstMatchday();
    expect(pickGradeablePrediction(repo)?.id).toBe(blind.id);
  });

  it('counts gradeable matches without building the whole report', async () => {
    const { blind, informed, matchday1 } = await playFirstMatchday();
    expect(repo.countGradeableMatches(blind.id)).toBe(matchday1.length);
    expect(repo.countGradeableMatches(informed.id)).toBe(0);
  });

  it('trends every gradeable batch in season order', async () => {
    const { blind, informed } = await playFirstMatchday();

    const history = repo.getAccuracyHistory();
    // The informed batch has nothing to grade, so it is omitted rather than shown as zero.
    expect(history.map((point) => point.predictionId)).toEqual([blind.id]);
    expect(history[0]).toMatchObject({ asOfMatchday: 1, graded: 10 });
    expect(history[0]!.skillScore).toBeCloseTo(
      repo.getPredictionAccuracy(blind.id).skillScore,
      10,
    );

    // Play matchday 2 as well; the informed batch now has something to say.
    for (const fixture of repo.getFixtures().filter((f) => f.matchday === 2)) {
      repo.setActualResult(fixture.matchNumber, 1, 1);
    }
    expect(repo.getAccuracyHistory().map((point) => point.predictionId)).toEqual([
      blind.id,
      informed.id,
    ]);
  });

  it('formats a report without throwing', async () => {
    const { blind } = await playFirstMatchday();
    const text = formatAccuracyReport(repo.getPredictionAccuracy(blind.id), true);
    expect(text).toContain('Brier score');
    expect(text).toContain('Calibration');
    expect(text).toContain('exact scoreline');
  });
});
