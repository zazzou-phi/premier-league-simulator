/**
 * Kickoffs are stored as local wall-clock date/time strings, so they are formatted by
 * slicing rather than through Date, which would reinterpret them in the viewer's zone.
 */
export function formatKickoff(date: string, time: string): string {
  const [, month = '??', day = '??'] = date.split('-');
  return `${day}.${month} ${time}`;
}

export function getFixturePrefixParts(
  matchday: number,
  date: string,
  time: string,
): { matchday: string; kickoff: string } {
  return { matchday: String(matchday), kickoff: formatKickoff(date, time) };
}
