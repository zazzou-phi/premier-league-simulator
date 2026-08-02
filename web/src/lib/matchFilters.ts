import type { ResolvedMatch } from '@shared/engine/types.js';

export function filterMatchesByTeam(
  matches: ResolvedMatch[],
  teamId: number | null,
): ResolvedMatch[] {
  if (teamId == null) return matches;
  return matches.filter(
    (match) => match.teamHome.id === teamId || match.teamAway.id === teamId,
  );
}

export function matchWinnerSide(match: ResolvedMatch): 'home' | 'away' | null {
  const { goalsHome, goalsAway, status } = match.result;
  if (status !== 'played' || goalsHome == null || goalsAway == null) return null;
  if (goalsHome > goalsAway) return 'home';
  if (goalsAway > goalsHome) return 'away';
  return null;
}

export function formatMatchScore(
  goalsHome: number | null,
  goalsAway: number | null,
  played: boolean,
): string {
  if (!played || goalsHome == null || goalsAway == null) return '- vs -';
  return `${goalsHome} - ${goalsAway}`;
}
