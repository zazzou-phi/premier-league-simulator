/**
 * The twenty-slot categorical palette the club charts draw from.
 *
 * Twenty hues is well past the eight or so a reader can hold apart by colour alone, so colour
 * here is a recall aid, never the identity: every line is directly labelled with its club code,
 * every legend chip names its club, and the projections table below is the same data as text.
 * A dash pattern rides along as a second channel so two clubs that land on neighbouring hues
 * still differ in stroke.
 *
 * The hexes themselves live in `app.css` as `--series-1 … --series-20`, stepped once for each
 * theme. Both sets were generated in OKLCH and checked with the data-viz palette validator —
 * every slot inside its mode's lightness band, above the chroma floor, and clear of the
 * colour-vision and normal-vision separation floors on adjacent slots.
 */

export const SERIES_SLOT_COUNT = 20;

/** Cycled across slots so hue-adjacent clubs differ in stroke as well as colour. */
const DASH_PATTERNS = [undefined, '7 3', '2 3', '11 3 2 3'] as const;

/**
 * A club's slot, fixed by its position in the id order rather than by any ranking.
 *
 * Colour follows the entity: re-sorting the table, changing the metric or filtering the chart
 * must never repaint the clubs that remain.
 */
export function seriesSlots(teamIds: number[]): Map<number, number> {
  const ordered = [...new Set(teamIds)].sort((a, b) => a - b);
  return new Map(ordered.map((teamId, index) => [teamId, index % SERIES_SLOT_COUNT]));
}

export function seriesColour(slot: number): string {
  return `var(--series-${(slot % SERIES_SLOT_COUNT) + 1})`;
}

export function seriesDash(slot: number): string | undefined {
  return DASH_PATTERNS[slot % DASH_PATTERNS.length];
}
