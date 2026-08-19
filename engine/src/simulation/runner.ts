import {
  DEFAULT_BASELINE_AWAY,
  DEFAULT_BASELINE_HOME,
  defaultRandomSource,
  simulateMatchOutcome,
  type RandomSource,
} from '../engine/matchSimulator.js';
import {
  computeEloDeltasFromMatches,
  effectiveElo,
  matchEloDelta,
  type EloMatchInput,
} from '../engine/seasonElo.js';
import type { Fixture, SimulationMatch, Team } from '../engine/types.js';
import { MatchLockedError, NotFoundError } from '../db/errors.js';
import type { Repository } from '../db/repository.js';

export interface RunnerOptions {
  baselineHome?: number;
  baselineAway?: number;
  upsetVariance?: number;
  eloK?: number;
  eloDeltaWeight?: number;
  rng?: RandomSource;
}

export interface SimulateResult {
  simulationId: number;
  matchesPlayed: number;
  matchesSkipped: number;
}

interface PendingFixture {
  fixture: Fixture;
  home: Team;
  away: Team;
}

type ActualResults = Map<number, { goalsHome: number; goalsAway: number }>;

/** Simulates matches inside a stored simulation, leaving played and locked fixtures alone. */
export class SeasonRunner {
  constructor(
    private readonly repo: Repository,
    private readonly options: RunnerOptions = {},
  ) {}

  /**
   * Read-time overlay of real results over a simulation's own rows.
   *
   * Recording a result no longer rewrites `simulation_matches`, so a locked fixture can still
   * be sitting there as `scheduled`. Overlaying before anything else is what keeps
   * {@link collectPending} from re-simulating a match that has already been played for real.
   */
  private withActuals(rows: SimulationMatch[], actuals: ActualResults): SimulationMatch[] {
    return rows.map((row) => {
      const actual = actuals.get(row.matchNumber);
      if (!actual) return row;
      return {
        ...row,
        goalsHome: actual.goalsHome,
        goalsAway: actual.goalsAway,
        status: 'played' as const,
      };
    });
  }

  private resolveOptions(overrides: RunnerOptions = {}) {
    const settings = this.repo.getSettings();
    return {
      baselineHome: overrides.baselineHome ?? this.options.baselineHome ?? DEFAULT_BASELINE_HOME,
      baselineAway: overrides.baselineAway ?? this.options.baselineAway ?? DEFAULT_BASELINE_AWAY,
      upsetVariance:
        overrides.upsetVariance ?? this.options.upsetVariance ?? settings.upsetVariance,
      eloDeltaWeight:
        overrides.eloDeltaWeight ?? this.options.eloDeltaWeight ?? settings.seasonEloDeltaWeight,
      eloK: overrides.eloK ?? this.options.eloK,
      rng: overrides.rng ?? this.options.rng ?? defaultRandomSource,
    };
  }

  /**
   * Matches whose scorelines are allowed to move a rating: this simulation's own earlier
   * results, and only those.
   *
   * Real results are excluded on purpose. Base Elo is refreshed weekly from clubelo, which has
   * already priced them in, so drifting on them again would count the same form twice. Note
   * the opposite polarity from {@link withActuals}, which overlays those very rows in.
   */
  private playedEloInputs(rows: SimulationMatch[], actuals: ActualResults): EloMatchInput[] {
    return rows.flatMap((row) =>
      row.status === 'played' &&
      row.goalsHome != null &&
      row.goalsAway != null &&
      !actuals.has(row.matchNumber)
        ? [
            {
              matchNumber: row.matchNumber,
              teamHomeId: row.teamHomeId,
              teamAwayId: row.teamAwayId,
              goalsHome: row.goalsHome,
              goalsAway: row.goalsAway,
            },
          ]
        : [],
    );
  }

  private simulatePending(
    simulationId: number,
    pending: PendingFixture[],
    rows: SimulationMatch[],
    teams: Team[],
    actuals: ActualResults,
    overrides: RunnerOptions,
  ): SimulateResult {
    const { baselineHome, baselineAway, upsetVariance, eloDeltaWeight, eloK, rng } =
      this.resolveOptions(overrides);

    // Seed drift from matches this simulation played itself, so form carries into new ones.
    const deltas = computeEloDeltasFromMatches(teams, this.playedEloInputs(rows, actuals), eloK);

    const byMatchday = new Map<number, PendingFixture[]>();
    for (const item of pending) {
      const list = byMatchday.get(item.fixture.matchday);
      if (list) list.push(item);
      else byMatchday.set(item.fixture.matchday, [item]);
    }

    const results: Array<{ matchNumber: number; goalsHome: number; goalsAway: number }> = [];

    for (const matchday of [...byMatchday.keys()].sort((a, b) => a - b)) {
      const dayFixtures = byMatchday
        .get(matchday)!
        .sort((a, b) => a.fixture.matchNumber - b.fixture.matchNumber);

      for (const { fixture, home, away } of dayFixtures) {
        const outcome = simulateMatchOutcome(
          {
            ...home,
            elo: effectiveElo(home.elo, deltas.get(home.id) ?? 0, eloDeltaWeight),
          },
          {
            ...away,
            elo: effectiveElo(away.elo, deltas.get(away.id) ?? 0, eloDeltaWeight),
          },
          { baselineHome, baselineAway, upsetVariance, rng },
        );

        results.push({
          matchNumber: fixture.matchNumber,
          goalsHome: outcome.goalsHome,
          goalsAway: outcome.goalsAway,
        });

        const [homeDelta, awayDelta] = matchEloDelta(
          home.elo + (deltas.get(home.id) ?? 0),
          away.elo + (deltas.get(away.id) ?? 0),
          outcome.goalsHome,
          outcome.goalsAway,
          eloK,
        );
        deltas.set(home.id, (deltas.get(home.id) ?? 0) + homeDelta);
        deltas.set(away.id, (deltas.get(away.id) ?? 0) + awayDelta);
      }
    }

    if (results.length > 0) this.repo.applyMatchResults(simulationId, results);

    return {
      simulationId,
      matchesPlayed: results.length,
      matchesSkipped: rows.length - results.length,
    };
  }

  private collectPending(
    rows: SimulationMatch[],
    fixturesByNumber: Map<number, Fixture>,
    teamsById: Map<number, Team>,
    filter: (fixture: Fixture) => boolean,
  ): PendingFixture[] {
    return rows.flatMap((row) => {
      if (row.status === 'played') return [];
      const fixture = fixturesByNumber.get(row.matchNumber);
      const home = teamsById.get(row.teamHomeId);
      const away = teamsById.get(row.teamAwayId);
      if (!fixture || !home || !away || !filter(fixture)) return [];
      return [{ fixture, home, away }];
    });
  }

  simulateRestOfSeason(simulationId: number, overrides: RunnerOptions = {}): SimulateResult {
    const teams = this.repo.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixturesByNumber = new Map(this.repo.getFixtures().map((f) => [f.matchNumber, f]));
    const actuals = this.repo.getActualResultsByMatch();
    const rows = this.withActuals(this.repo.getSimulationMatches(simulationId), actuals);
    const pending = this.collectPending(rows, fixturesByNumber, teamsById, () => true);
    return this.simulatePending(simulationId, pending, rows, teams, actuals, overrides);
  }

  simulateUpToMatchday(
    simulationId: number,
    matchday: number,
    overrides: RunnerOptions = {},
  ): SimulateResult {
    const teams = this.repo.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixturesByNumber = new Map(this.repo.getFixtures().map((f) => [f.matchNumber, f]));
    const actuals = this.repo.getActualResultsByMatch();
    const rows = this.withActuals(this.repo.getSimulationMatches(simulationId), actuals);
    const pending = this.collectPending(
      rows,
      fixturesByNumber,
      teamsById,
      (fixture) => fixture.matchday <= matchday,
    );
    return this.simulatePending(simulationId, pending, rows, teams, actuals, overrides);
  }

  simulateNextMatchday(simulationId: number, overrides: RunnerOptions = {}): SimulateResult {
    const fixturesByNumber = new Map(this.repo.getFixtures().map((f) => [f.matchNumber, f]));
    const rows = this.withActuals(
      this.repo.getSimulationMatches(simulationId),
      this.repo.getActualResultsByMatch(),
    );
    const nextMatchday = rows
      .filter((row) => row.status !== 'played')
      .map((row) => fixturesByNumber.get(row.matchNumber)?.matchday)
      .filter((matchday): matchday is number => matchday != null)
      .sort((a, b) => a - b)[0];

    if (nextMatchday == null) {
      return { simulationId, matchesPlayed: 0, matchesSkipped: rows.length };
    }
    return this.simulateUpToMatchday(simulationId, nextMatchday, overrides);
  }

  simulateSingleMatch(
    simulationId: number,
    matchNumber: number,
    overrides: RunnerOptions = {},
  ): SimulateResult {
    const teams = this.repo.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixture = this.repo.getFixture(matchNumber);
    if (!fixture) throw new NotFoundError(`Fixture ${matchNumber}`);

    const actuals = this.repo.getActualResultsByMatch();
    // This path builds its own pending fixture rather than going through collectPending, so it
    // needs the lock check that collectPending would otherwise have applied.
    if (actuals.has(matchNumber)) throw new MatchLockedError(matchNumber);

    const rows = this.withActuals(this.repo.getSimulationMatches(simulationId), actuals);
    const row = rows.find((r) => r.matchNumber === matchNumber);
    if (!row) throw new NotFoundError(`Match ${matchNumber} in simulation ${simulationId}`);

    const home = teamsById.get(row.teamHomeId)!;
    const away = teamsById.get(row.teamAwayId)!;

    // Exclude this fixture's own prior result so a resimulation is not biased by it.
    const others = rows.filter((r) => r.matchNumber !== matchNumber);
    return this.simulatePending(
      simulationId,
      [{ fixture, home, away }],
      others,
      teams,
      actuals,
      overrides,
    );
  }
}
