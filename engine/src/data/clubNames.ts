/**
 * clubelo uses short informal club names. Map them to display names and the
 * three-letter codes used in compact table and fixture layouts.
 */
export interface ClubIdentity {
  name: string;
  shortName: string;
}

export const CLUB_IDENTITIES: Record<string, ClubIdentity> = {
  Arsenal: { name: 'Arsenal', shortName: 'ARS' },
  'Aston Villa': { name: 'Aston Villa', shortName: 'AVL' },
  Bournemouth: { name: 'Bournemouth', shortName: 'BOU' },
  Brentford: { name: 'Brentford', shortName: 'BRE' },
  Brighton: { name: 'Brighton & Hove Albion', shortName: 'BHA' },
  Burnley: { name: 'Burnley', shortName: 'BUR' },
  Chelsea: { name: 'Chelsea', shortName: 'CHE' },
  Coventry: { name: 'Coventry City', shortName: 'COV' },
  'Crystal Palace': { name: 'Crystal Palace', shortName: 'CRY' },
  Everton: { name: 'Everton', shortName: 'EVE' },
  Forest: { name: 'Nottingham Forest', shortName: 'NFO' },
  Fulham: { name: 'Fulham', shortName: 'FUL' },
  Hull: { name: 'Hull City', shortName: 'HUL' },
  Ipswich: { name: 'Ipswich Town', shortName: 'IPS' },
  Leeds: { name: 'Leeds United', shortName: 'LEE' },
  Leicester: { name: 'Leicester City', shortName: 'LEI' },
  Liverpool: { name: 'Liverpool', shortName: 'LIV' },
  Luton: { name: 'Luton Town', shortName: 'LUT' },
  'Man City': { name: 'Manchester City', shortName: 'MCI' },
  'Man United': { name: 'Manchester United', shortName: 'MUN' },
  Middlesbrough: { name: 'Middlesbrough', shortName: 'MID' },
  Newcastle: { name: 'Newcastle United', shortName: 'NEW' },
  Norwich: { name: 'Norwich City', shortName: 'NOR' },
  'Sheffield United': { name: 'Sheffield United', shortName: 'SHU' },
  Southampton: { name: 'Southampton', shortName: 'SOU' },
  Sunderland: { name: 'Sunderland', shortName: 'SUN' },
  Tottenham: { name: 'Tottenham Hotspur', shortName: 'TOT' },
  Watford: { name: 'Watford', shortName: 'WAT' },
  'West Brom': { name: 'West Bromwich Albion', shortName: 'WBA' },
  'West Ham': { name: 'West Ham United', shortName: 'WHU' },
  Wolves: { name: 'Wolverhampton Wanderers', shortName: 'WOL' },
};

function fallbackShortName(clubeloName: string): string {
  const letters = clubeloName.replace(/[^A-Za-z ]/g, '');
  const words = letters.split(' ').filter(Boolean);
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]!).join('').toUpperCase();
  return letters.replace(/ /g, '').slice(0, 3).toUpperCase();
}

export function identityForClub(clubeloName: string): ClubIdentity {
  return (
    CLUB_IDENTITIES[clubeloName] ?? {
      name: clubeloName,
      shortName: fallbackShortName(clubeloName),
    }
  );
}
