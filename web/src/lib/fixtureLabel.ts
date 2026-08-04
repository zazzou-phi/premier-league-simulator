/**
 * Kickoffs are stored as local wall-clock date/time strings, so they are formatted by
 * slicing rather than through Date, which would reinterpret them in the viewer's zone.
 */
export function formatKickoff(date: string, time: string): string {
  const [, month = '??', day = '??'] = date.split('-');
  return `${day}.${month} ${time}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Long form of the same wall-clock date, for prose rather than a fixture row. */
export function formatKickoffDate(date: string): string {
  const [year, month, day] = date.split('-');
  const monthName = month ? MONTH_NAMES[Number(month) - 1] : undefined;
  if (!monthName || !day || !year) return date;
  return `${Number(day)} ${monthName} ${year}`;
}

export function getFixturePrefixParts(
  matchday: number,
  date: string,
  time: string,
): { matchday: string; kickoff: string } {
  return { matchday: String(matchday), kickoff: formatKickoff(date, time) };
}
