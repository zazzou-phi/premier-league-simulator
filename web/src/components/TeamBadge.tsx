import type { Team } from '@shared/engine/types.js';

interface Props {
  /** The club, when it could be resolved. Projection rows may not carry it. */
  team: Pick<Team, 'shortName' | 'crest'> | undefined;
  /** Full club name, used as the crest's alt text. */
  teamName: string;
  /**
   * The existing per-context chip class. Passing it keeps the zone colouring
   * (`.zone-champion .league-table-short`) and spacing that four call sites already
   * relied on, while the markup itself lives here in one place.
   */
  codeClassName?: string;
}

/**
 * The single place a club's short code — and, once sourced, its crest — is rendered.
 * `crest` is `null` for every club today, so this always falls back to the code chip and
 * the UI is unchanged; the seam is here so crests can drop in without touching call sites.
 */
export function TeamBadge({ team, teamName, codeClassName = 'team-badge-code' }: Props) {
  if (team?.crest) {
    return (
      <img className="team-badge-crest" src={team.crest} alt={teamName} width={16} height={16} />
    );
  }
  return <span className={codeClassName}>{team?.shortName ?? ''}</span>;
}
