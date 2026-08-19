import type { StandingRow, Team } from './types.js';

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;

export const TEAM_COUNT = 20;
export const CHAMPIONS_LEAGUE_PLACES = 4;
export const EUROPA_LEAGUE_PLACE = 5;
export const RELEGATION_PLACES = 3;

export type LeagueZone = 'champion' | 'championsLeague' | 'europaLeague' | 'midtable' | 'relegation';

export function zoneForPosition(position: number, teamCount = TEAM_COUNT): LeagueZone {
  if (position === 1) return 'champion';
  if (position <= CHAMPIONS_LEAGUE_PLACES) return 'championsLeague';
  if (position === EUROPA_LEAGUE_PLACE) return 'europaLeague';
  if (position > teamCount - RELEGATION_PLACES) return 'relegation';
  return 'midtable';
}

export interface PlayedMatch {
  homeTeamId: number;
  awayTeamId: number;
  goalsHome: number;
  goalsAway: number;
}

interface MutableRow {
  teamId: number;
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/** A team's running totals, as carried by a partial table. */
export interface TeamTotals {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

function initRow(team: Team, base?: ReadonlyMap<number, TeamTotals>): MutableRow {
  const totals = base?.get(team.id);
  // Copied field by field, never aliased: the caller's map is reused across every Monte Carlo
  // run, and a shared reference here would compound each run's results into the next.
  return {
    teamId: team.id,
    team,
    played: totals?.played ?? 0,
    won: totals?.won ?? 0,
    drawn: totals?.drawn ?? 0,
    lost: totals?.lost ?? 0,
    goalsFor: totals?.goalsFor ?? 0,
    goalsAgainst: totals?.goalsAgainst ?? 0,
    points: totals?.points ?? 0,
  };
}

/**
 * Fold matches into a starting table that {@link computeLeagueStandings} can be seeded with.
 *
 * Monte Carlo uses this to bank the season's real results once per batch rather than replaying
 * them in every run.
 */
export function accumulateTotals(teams: Team[], matches: PlayedMatch[]): Map<number, TeamTotals> {
  const rowsById = new Map<number, MutableRow>();
  for (const team of teams) rowsById.set(team.id, initRow(team));

  applyAll(rowsById, matches);

  return new Map(
    [...rowsById.entries()].map(([teamId, row]) => [
      teamId,
      {
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        points: row.points,
      },
    ]),
  );
}

function applyAll(rowsById: Map<number, MutableRow>, matches: PlayedMatch[]): void {
  for (const match of matches) {
    const home = rowsById.get(match.homeTeamId);
    const away = rowsById.get(match.awayTeamId);
    if (!home || !away) continue;
    applyResult(home, match.goalsHome, match.goalsAway);
    applyResult(away, match.goalsAway, match.goalsHome);
  }
}

function applyResult(row: MutableRow, goalsFor: number, goalsAgainst: number): void {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  if (goalsFor > goalsAgainst) {
    row.won += 1;
    row.points += POINTS_WIN;
  } else if (goalsFor === goalsAgainst) {
    row.drawn += 1;
    row.points += POINTS_DRAW;
  } else {
    row.lost += 1;
  }
}

/**
 * Premier League order: points, then goal difference, then goals scored. The real
 * competition leaves teams level beyond that (a play-off decides places that matter),
 * so name is used last to keep the table deterministic.
 */
function compareRows(a: MutableRow, b: MutableRow): number {
  if (a.points !== b.points) return b.points - a.points;
  const gdA = a.goalsFor - a.goalsAgainst;
  const gdB = b.goalsFor - b.goalsAgainst;
  if (gdA !== gdB) return gdB - gdA;
  if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
  return a.team.name.localeCompare(b.team.name);
}

/**
 * The table after `matches`, optionally starting from a table that already holds some.
 *
 * `base` is read, never mutated — see {@link initRow}.
 */
export function computeLeagueStandings(
  teams: Team[],
  matches: PlayedMatch[],
  base?: ReadonlyMap<number, TeamTotals>,
): StandingRow[] {
  const rowsById = new Map<number, MutableRow>();
  for (const team of teams) rowsById.set(team.id, initRow(team, base));

  applyAll(rowsById, matches);

  return [...rowsById.values()].sort(compareRows).map((row, index) => ({
    teamId: row.teamId,
    team: row.team,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalsFor - row.goalsAgainst,
    points: row.points,
    position: index + 1,
  }));
}

/**
 * Final positions only, ordered by team id index. Used by Monte Carlo, which runs this
 * once per simulated season and needs to avoid allocating full standing rows.
 */
export function computeFinalPositions(
  teams: Team[],
  matches: PlayedMatch[],
  base?: ReadonlyMap<number, TeamTotals>,
): Map<number, number> {
  const standings = computeLeagueStandings(teams, matches, base);
  return new Map(standings.map((row) => [row.teamId, row.position]));
}
