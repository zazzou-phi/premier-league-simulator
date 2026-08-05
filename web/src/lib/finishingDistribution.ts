/** English ordinal for a league position: 1st, 2nd, 3rd, 4th, … 11th, 21st. */
export function ordinalPosition(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * The p-th percentile finishing position: the lowest position whose cumulative share of
 * seasons reaches `p` (0–1). Drawn as a confidence-interval tick on the distribution so the
 * eye gets a spread without a legend. Null when there are no seasons to summarise.
 */
export function percentilePosition(
  positionCounts: number[],
  total: number,
  p: number,
): number | null {
  if (total <= 0) return null;
  const threshold = total * p;
  let cumulative = 0;
  for (let i = 0; i < positionCounts.length; i += 1) {
    cumulative += positionCounts[i] ?? 0;
    if (cumulative >= threshold) return i + 1;
  }
  return positionCounts.length;
}
