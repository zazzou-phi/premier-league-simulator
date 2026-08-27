export type MatchStatus = 'scheduled' | 'played';

export interface Team {
  id: number;
  name: string;
  shortName: string;
  crest: string | null;
  /** Current rating: {@link anchorElo} plus the Elo update from every real result to date. */
  elo: number;
  /**
   * Last rating that came from outside the model, and the fixed point the current rating is
   * recomputed from. Null only on rows written before the column existed.
   */
  anchorElo?: number | null;
}

export interface Fixture {
  matchNumber: number;
  matchday: number;
  date: string;
  time: string;
  teamHomeId: number;
  teamAwayId: number;
}

export interface SimulationMatch {
  simulationId: number;
  matchNumber: number;
  teamHomeId: number;
  teamAwayId: number;
  goalsHome: number | null;
  goalsAway: number | null;
  status: MatchStatus;
}

export interface ResolvedMatch {
  fixture: Fixture;
  teamHome: Team;
  teamAway: Team;
  result: {
    goalsHome: number | null;
    goalsAway: number | null;
    status: MatchStatus;
  };
  /** True when an actual real-world result is recorded for this fixture. */
  locked: boolean;
  /**
   * The scoreline the batch picked, kept alongside `result` so a played fixture can show what
   * was forecast next to what happened. Null on a fixture the batch was handed rather than
   * predicted (it was already locked when the batch ran), because replaying a known result is
   * not a forecast — the same reason grading excludes those fixtures.
   */
  pick?: { goalsHome: number; goalsAway: number } | null;
}

export interface StandingRow {
  teamId: number;
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: number;
}

export interface Simulation {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeasonState {
  simulationId: number;
  teams: Team[];
  matches: ResolvedMatch[];
  standings: StandingRow[];
  matchesPlayed: number;
  matchesTotal: number;
}

export interface ActualMatchResult {
  matchNumber: number;
  goalsHome: number;
  goalsAway: number;
  recordedAt: string;
}
