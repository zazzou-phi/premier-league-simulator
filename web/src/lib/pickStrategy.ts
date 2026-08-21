import { DEFAULT_PICK_STRATEGY, type PickStrategy } from '@shared/engine/pickStrategy.js';

export { DEFAULT_PICK_STRATEGY };
export type { PickStrategy };

export const PICK_STRATEGY_OPTIONS: Array<{ value: PickStrategy; label: string }> = [
  { value: 'plausible', label: 'Plausible season' },
  { value: 'calibrated', label: 'Calibrated' },
  { value: 'random', label: 'Random season' },
];

export const PICK_STRATEGY_HINT =
  'How a spread of simulated scorelines collapses into the single scoreline shown for each fixture.';

/**
 * The season-level trade-off each strategy makes. Listed in the help modal rather than under
 * the buttons, so switching between them is not a wall of prose.
 */
export const PICK_STRATEGY_DESCRIPTIONS: Record<PickStrategy, string> = {
  plausible:
    'Calibrated, but aimed at a season that could actually happen. Tries each simulated season in the batch as a draw profile and keeps whichever is worth the most, so clubs spread out the way they do in a real table instead of all landing near the average.',
  calibrated:
    'Picks the whole season at once so the win/draw/loss counts match what the simulation expects — both overall and per team. Faithful on average, but every club ends up within a draw or two of the league mean.',
  random: 'One complete simulated season, replayed as it happened. Coherent, but a single draw.',
};

export function formatPickStrategy(strategy: PickStrategy): string {
  return PICK_STRATEGY_OPTIONS.find((option) => option.value === strategy)?.label ?? strategy;
}
