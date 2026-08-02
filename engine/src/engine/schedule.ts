import type { Fixture } from './types.js';

export const MATCHDAYS = 38;
export const MATCHES_PER_MATCHDAY = 10;
export const TOTAL_MATCHES = MATCHDAYS * MATCHES_PER_MATCHDAY;

export interface SchedulePairing {
  homeTeamId: number;
  awayTeamId: number;
}

/**
 * Single round-robin via the circle method: one team stays fixed while the rest rotate.
 * Venues alternate by round so neither half of the season is badly lopsided.
 */
export function buildSingleRoundRobin(teamIds: number[]): SchedulePairing[][] {
  const n = teamIds.length;
  if (n < 2 || n % 2 !== 0) {
    throw new Error(`Round-robin requires an even team count of at least 2, got ${n}`);
  }

  const [fixed, ...rotating] = teamIds;
  let rotation = rotating;
  const rounds: SchedulePairing[][] = [];

  for (let round = 0; round < n - 1; round++) {
    const line = [fixed!, ...rotation];
    const pairings: SchedulePairing[] = [];

    for (let i = 0; i < n / 2; i++) {
      const a = line[i]!;
      const b = line[n - 1 - i]!;
      const aAtHome = i === 0 ? round % 2 === 0 : (round + i) % 2 === 0;
      pairings.push(
        aAtHome ? { homeTeamId: a, awayTeamId: b } : { homeTeamId: b, awayTeamId: a },
      );
    }

    rounds.push(pairings);
    rotation = [rotation[rotation.length - 1]!, ...rotation.slice(0, -1)];
  }

  return rounds;
}

/** Second half mirrors the first with venues swapped, giving every team 19 home and 19 away. */
export function buildDoubleRoundRobin(teamIds: number[]): SchedulePairing[][] {
  const firstHalf = buildSingleRoundRobin(teamIds);
  const secondHalf = firstHalf.map((round) =>
    round.map(({ homeTeamId, awayTeamId }) => ({
      homeTeamId: awayTeamId,
      awayTeamId: homeTeamId,
    })),
  );
  return [...firstHalf, ...secondHalf];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Kickoff slots cycled through each matchday so fixtures are not all at the same time. */
const KICKOFF_SLOTS = ['12:30', '15:00', '15:00', '15:00', '15:00', '17:30', '14:00', '14:00', '16:30', '20:00'];

export interface GenerateFixturesOptions {
  /** First matchday date; later matchdays fall one week apart. */
  seasonStart?: string;
}

export function generateFixtures(
  teamIds: number[],
  options: GenerateFixturesOptions = {},
): Fixture[] {
  const rounds = buildDoubleRoundRobin(teamIds);
  const start = new Date(`${options.seasonStart ?? '2026-08-15'}T00:00:00Z`);
  const fixtures: Fixture[] = [];
  let matchNumber = 1;

  rounds.forEach((round, roundIndex) => {
    const matchday = roundIndex + 1;
    const saturday = addDays(start, roundIndex * 7);

    round.forEach((pairing, slotIndex) => {
      // Slots 6 onward run on the Sunday of the same weekend.
      const dayOffset = slotIndex >= 6 ? 1 : 0;
      fixtures.push({
        matchNumber: matchNumber++,
        matchday,
        date: formatDate(addDays(saturday, dayOffset)),
        time: KICKOFF_SLOTS[slotIndex % KICKOFF_SLOTS.length]!,
        teamHomeId: pairing.homeTeamId,
        teamAwayId: pairing.awayTeamId,
      });
    });
  });

  return fixtures;
}

/**
 * Lowest matchday with an unplayed fixture — the round a fresh projection is facing.
 * Null once every fixture is played. Postponements mean this is not always the highest
 * played matchday plus one, so it is computed rather than counted.
 */
export function findNextMatchday(
  fixtures: Fixture[],
  playedMatchNumbers: ReadonlySet<number>,
): number | null {
  let next: number | null = null;
  for (const fixture of fixtures) {
    if (playedMatchNumbers.has(fixture.matchNumber)) continue;
    if (next == null || fixture.matchday < next) next = fixture.matchday;
  }
  return next;
}
