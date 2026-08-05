import type { Team } from '@shared/engine/types.js';

/**
 * Index teams by id. Projection rows carry only `teamId` and `teamName`, so three
 * components each built their own `shortName` map to recover the code; `TeamBadge` needs
 * the whole club (for `crest`), so they share this one lookup instead.
 */
export function teamsById(teams: Team[]): Map<number, Team> {
  return new Map(teams.map((team) => [team.id, team]));
}
