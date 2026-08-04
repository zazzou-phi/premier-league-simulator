/**
 * Render a 0–1 probability for display. Zero reads as an em dash rather than `0.0%` so an
 * impossible outcome is visibly different from a merely unlikely one, which floors at `<0.1%`.
 */
export function formatProbability(value: number): string {
  if (value === 0) return '—';
  if (value < 0.001) return '<0.1%';
  return `${(value * 100).toFixed(1)}%`;
}
