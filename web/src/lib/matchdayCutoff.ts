import type { PlayedMatch } from '@shared/engine/standings.js';
import type { ResolvedMatch } from '@shared/engine/types.js';

/**
 * The season view is read "as of" a matchday: every fixture up to the cutoff has been played —
 * with its real score where one is recorded and its picked scoreline otherwise — and everything
 * after it is still to come. Table and fixture list are cut by the same rule so they can never
 * disagree about which matches count.
 */

/** Highest matchday in the calendar. The cutoff's upper bound, and its default. */
export function lastMatchday(matches: ResolvedMatch[]): number {
  let last = 0;
  for (const match of matches) {
    if (match.fixture.matchday > last) last = match.fixture.matchday;
  }
  return last;
}

/**
 * Highest matchday holding a real result — where the season actually stands.
 *
 * Not `nextMatchday - 1`: a postponement leaves an earlier round open while later rounds are
 * played, and the cut still has to reach the results that have landed. The postponed fixture
 * falls below the cutoff and takes its picked scoreline, which is what "as of" means.
 */
export function playedThroughMatchday(matches: ResolvedMatch[]): number {
  let last = 0;
  for (const match of matches) {
    if (match.locked && match.fixture.matchday > last) last = match.fixture.matchday;
  }
  return last;
}

/**
 * Lowest matchday still waiting on a real result — the round being played next, or about to be.
 * Null once every fixture has one.
 */
export function nextOpenMatchday(matches: ResolvedMatch[]): number | null {
  let next: number | null = null;
  for (const match of matches) {
    if (match.locked) continue;
    if (next == null || match.fixture.matchday < next) next = match.fixture.matchday;
  }
  return next;
}

/**
 * Where "now" cuts the season: everything played, plus the next round still to be played, which
 * the cut fills in with its picks. A reader asking for now wants the round in front of them as
 * well as the ones behind — the results alone are yesterday's table.
 *
 * The later of the two rather than `nextOpenMatchday`: a postponement leaves an earlier round
 * open while later rounds are played, and the cut still has to reach the results that landed.
 */
export function nowMatchday(matches: ResolvedMatch[]): number {
  return Math.max(playedThroughMatchday(matches), nextOpenMatchday(matches) ?? 0);
}

/** Blank every fixture past `cutoff`, so the rounds beyond it read as not yet played. */
export function applyMatchdayCutoff(matches: ResolvedMatch[], cutoff: number): ResolvedMatch[] {
  return matches.map((match) => {
    if (match.fixture.matchday <= cutoff) return match;
    if (match.result.status === 'scheduled' && !match.locked && match.pick == null) return match;
    return {
      ...match,
      result: { goalsHome: null, goalsAway: null, status: 'scheduled' },
      locked: false,
      pick: null,
    };
  });
}

/** The matches a table over this cut is built from. */
export function playedMatchesFor(matches: ResolvedMatch[]): PlayedMatch[] {
  const played: PlayedMatch[] = [];
  for (const match of matches) {
    const { goalsHome, goalsAway, status } = match.result;
    if (status !== 'played' || goalsHome == null || goalsAway == null) continue;
    played.push({
      homeTeamId: match.teamHome.id,
      awayTeamId: match.teamAway.id,
      goalsHome,
      goalsAway,
    });
  }
  return played;
}
