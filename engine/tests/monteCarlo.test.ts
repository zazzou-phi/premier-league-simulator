import { describe, expect, it } from 'vitest';
import { generateFixtures } from '../src/engine/schedule.js';
import type { Team } from '../src/engine/types.js';
import { runMonteCarlo } from '../src/simulation/monteCarlo.js';
import { simulateSeason } from '../src/simulation/seasonSimulator.js';
import { testRng } from './testRng.js';

function makeTeams(count = 20): Team[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Team ${String(i + 1).padStart(2, '0')}`,
    shortName: `T${i + 1}`,
    crest: null,
    elo: 1900 - i * 20,
  }));
}

const teams = makeTeams();
const fixtures = generateFixtures(teams.map((t) => t.id));

describe('simulateSeason', () => {
  it('plays every fixture exactly once', () => {
    const { matches } = simulateSeason(teams, fixtures, { rng: testRng(1) });
    expect(matches).toHaveLength(380);
    expect(new Set(matches.map((m) => m.matchNumber)).size).toBe(380);
  });

  it('is deterministic for a given seed', () => {
    const a = simulateSeason(teams, fixtures, { rng: testRng(9) });
    const b = simulateSeason(teams, fixtures, { rng: testRng(9) });
    expect(a.matches).toEqual(b.matches);
  });

  it('starts from seeded drift rather than from a clean slate', () => {
    const remainder = fixtures.filter((f) => f.matchNumber > 1);
    const seedEloDeltas = new Map([[1, 300]]);

    const seeded = simulateSeason(teams, remainder, { rng: testRng(4), seedEloDeltas });
    const clean = simulateSeason(teams, remainder, { rng: testRng(4) });

    expect(seeded.eloDeltas.get(1)).toBeGreaterThan(clean.eloDeltas.get(1) ?? 0);
    expect(seeded.matches).not.toEqual(clean.matches);
  });

  it('does not mutate the seed map it was handed', () => {
    const seedEloDeltas = new Map([[1, 50]]);
    simulateSeason(teams, fixtures, { rng: testRng(5), seedEloDeltas });
    expect(seedEloDeltas.get(1)).toBe(50);
    expect(seedEloDeltas.size).toBe(1);
  });

  it('simulates exactly the fixtures it is given', () => {
    const remainder = fixtures.filter((f) => f.matchNumber > 2);
    const { matches } = simulateSeason(teams, remainder, { rng: testRng(2) });
    expect(matches).toHaveLength(378);
    expect(matches.some((m) => m.matchNumber <= 2)).toBe(false);
    expect(matches.every((m) => m.locked === false)).toBe(true);
  });

  it('accumulates in-season Elo drift', () => {
    const { eloDeltas } = simulateSeason(teams, fixtures, { rng: testRng(4) });
    expect(eloDeltas.size).toBe(20);
    const total = [...eloDeltas.values()].reduce((sum, d) => sum + d, 0);
    // Elo is zero-sum, so drift across the league cancels out.
    expect(total).toBeCloseTo(0, 6);
  });

  it('leaves ratings untouched when the delta weight is zero', () => {
    const a = simulateSeason(teams, fixtures, { rng: testRng(6), eloDeltaWeight: 0 });
    const b = simulateSeason(teams, fixtures, { rng: testRng(6), eloDeltaWeight: 0 });
    expect(a.matches).toEqual(b.matches);
  });
});

describe('runMonteCarlo', () => {
  it('rejects invalid run counts', async () => {
    await expect(runMonteCarlo(teams, fixtures, { runs: 0 })).rejects.toThrow(/positive integer/);
    await expect(runMonteCarlo(teams, fixtures, { runs: 200_000 })).rejects.toThrow(/must not exceed/);
  });

  it('produces probabilities that sum to the number of places available', async () => {
    const result = await runMonteCarlo(teams, fixtures, { runs: 60, rng: testRng(21) });

    const sum = (pick: (t: (typeof result.teams)[number]) => number) =>
      result.teams.reduce((total, team) => total + pick(team), 0);

    expect(sum((t) => t.titleProbability)).toBeCloseTo(1, 6);
    expect(sum((t) => t.championsLeagueProbability)).toBeCloseTo(4, 6);
    expect(sum((t) => t.europeanProbability)).toBeCloseTo(5, 6);
    expect(sum((t) => t.relegationProbability)).toBeCloseTo(3, 6);
  });

  it('records a position distribution covering every run', async () => {
    const runs = 40;
    const result = await runMonteCarlo(teams, fixtures, { runs, rng: testRng(8) });
    for (const team of result.teams) {
      expect(team.positionCounts).toHaveLength(20);
      expect(team.positionCounts.reduce((sum, n) => sum + n, 0)).toBe(runs);
    }
  });

  it('builds outcome and scoreline distributions for every fixture', async () => {
    const runs = 30;
    const result = await runMonteCarlo(teams, fixtures, { runs, rng: testRng(12) });
    expect(result.matchDistributions).toHaveLength(380);

    for (const dist of result.matchDistributions) {
      const { homeWin, draw, awayWin, total } = dist.outcomes;
      expect(homeWin + draw + awayWin).toBe(total);
      expect(total).toBe(runs);
      expect(dist.scorelines.reduce((sum, s) => sum + s.n, 0)).toBe(runs);
    }
  });

  it('ranks stronger teams above weaker ones', async () => {
    const result = await runMonteCarlo(teams, fixtures, { runs: 100, rng: testRng(15) });
    const byId = new Map(result.teams.map((t) => [t.teamId, t]));
    const strongest = byId.get(1)!;
    const weakest = byId.get(20)!;

    // Elo gaps of 20 are small; assert strength shows up in points rather than an
    // exact table position that sampling noise can shuffle.
    expect(strongest.averagePoints).toBeGreaterThan(weakest.averagePoints + 10);
    expect(strongest.averagePosition).toBeLessThan(weakest.averagePosition);
    expect(strongest.titleProbability).toBeGreaterThan(weakest.titleProbability);
  });

  it('caps the reservoir and keeps whole seasons', async () => {
    const result = await runMonteCarlo(teams, fixtures, {
      runs: 40,
      reservoirSize: 5,
      rng: testRng(17),
    });
    expect(result.sampledSeasons).toHaveLength(5);
    for (const season of result.sampledSeasons) {
      expect(season.matches).toHaveLength(380);
    }
    expect(new Set(result.sampledSeasons.map((s) => s.runIndex)).size).toBe(5);
  });

  it('keeps every run when the reservoir is larger than the batch', async () => {
    const result = await runMonteCarlo(teams, fixtures, {
      runs: 3,
      reservoirSize: 10,
      rng: testRng(19),
    });
    expect(result.sampledSeasons).toHaveLength(3);
  });

  it('can disable season sampling', async () => {
    const result = await runMonteCarlo(teams, fixtures, {
      runs: 5,
      reservoirSize: 0,
      rng: testRng(23),
    });
    expect(result.sampledSeasons).toHaveLength(0);
  });

  it('reports progress ending at the total', async () => {
    const seen: Array<[number, number]> = [];
    await runMonteCarlo(teams, fixtures, {
      runs: 10,
      rng: testRng(25),
      onProgress: (completed, total) => {
        seen.push([completed, total]);
      },
    });
    expect(seen.at(-1)).toEqual([10, 10]);
  });

  it('respects locked results across every run', async () => {
    const lockedResults = new Map([[1, { goalsHome: 5, goalsAway: 5 }]]);
    const result = await runMonteCarlo(teams, fixtures, {
      runs: 10,
      rng: testRng(27),
      lockedResults,
    });
    const first = result.matchDistributions.find((d) => d.matchNumber === 1)!;
    expect(first.outcomes.draw).toBe(10);
    expect(first.scorelines).toEqual([{ goalsHome: 5, goalsAway: 5, n: 10 }]);
  });

  it('still describes all 380 fixtures when some are locked', async () => {
    const runs = 20;
    const lockedResults = new Map([
      [1, { goalsHome: 3, goalsAway: 0 }],
      [2, { goalsHome: 1, goalsAway: 1 }],
      [11, { goalsHome: 0, goalsAway: 2 }],
    ]);
    const result = await runMonteCarlo(teams, fixtures, {
      runs,
      reservoirSize: 4,
      rng: testRng(31),
      lockedResults,
    });

    // The persisted shape is the same whether a fixture was simulated or banked.
    expect(result.matchDistributions).toHaveLength(380);
    for (const dist of result.matchDistributions) {
      expect(dist.outcomes.homeWin + dist.outcomes.draw + dist.outcomes.awayWin).toBe(runs);
      expect(dist.outcomes.total).toBe(runs);
      expect(dist.scorelines.reduce((sum, s) => sum + s.n, 0)).toBe(runs);
    }
    expect(result.matchDistributions.find((d) => d.matchNumber === 1)!.outcomes.homeWin).toBe(runs);
    expect(result.matchDistributions.find((d) => d.matchNumber === 11)!.outcomes.awayWin).toBe(runs);

    for (const season of result.sampledSeasons) {
      expect(season.matches).toHaveLength(380);
      expect(season.matches.map((m) => m.matchNumber)).toEqual(
        [...season.matches.map((m) => m.matchNumber)].sort((a, b) => a - b),
      );
      const locked = season.matches.filter((m) => m.locked);
      expect(locked).toHaveLength(3);
      expect(locked.find((m) => m.matchNumber === 2)).toMatchObject({
        goalsHome: 1,
        goalsAway: 1,
      });
    }
  });

  it('banks locked results into the table instead of replaying them', async () => {
    // Same season, two ways of saying "match 1 finished 3-0": as a lock, or by handing the
    // simulator only the remainder. Identical seeds must give identical projections.
    //
    // Drift is off on both sides on purpose. A locked result now moves a rating, so with
    // drift on the two runs legitimately diverge; pinning the weight at 0 isolates the
    // question this test is actually asking, which is whether the lock is banked or replayed.
    const lockedResults = new Map([[1, { goalsHome: 3, goalsAway: 0 }]]);
    const banked = await runMonteCarlo(teams, fixtures, {
      runs: 25,
      reservoirSize: 0,
      rng: testRng(33),
      lockedResults,
      eloDeltaWeight: 0,
    });

    const remainderOnly = await runMonteCarlo(
      teams,
      fixtures.filter((f) => f.matchNumber !== 1),
      { runs: 25, reservoirSize: 0, rng: testRng(33), eloDeltaWeight: 0 },
    );

    const first = fixtures.find((f) => f.matchNumber === 1)!;
    for (const team of banked.teams) {
      const other = remainderOnly.teams.find((t) => t.teamId === team.teamId)!;
      const bonus =
        team.teamId === first.teamHomeId ? 3 : team.teamId === first.teamAwayId ? 0 : 0;
      expect(team.averagePoints).toBeCloseTo(other.averagePoints + bonus, 6);
    }
  });

  it('lets a locked fixture drift a rating', async () => {
    // Which way the lock went has to reach the Elo update: the away side is stronger for the
    // rest of the season having won it than having lost it. Compared against the same fixture
    // set and seed, so only the locked scoreline differs.
    const awayId = fixtures.find((f) => f.matchNumber === 1)!.teamAwayId;
    const project = async (goalsHome: number, goalsAway: number) =>
      (
        await runMonteCarlo(teams, fixtures, {
          runs: 40,
          reservoirSize: 0,
          rng: testRng(36),
          lockedResults: new Map([[1, { goalsHome, goalsAway }]]),
          eloDeltaWeight: 1,
        })
      ).teams.find((t) => t.teamId === awayId)!.averagePoints;

    const won = await project(0, 1);
    const lost = await project(1, 0);
    // The 3 banked points are worth exactly 3; anything beyond that is drift.
    expect(won - lost).toBeGreaterThan(3);
  });
});
