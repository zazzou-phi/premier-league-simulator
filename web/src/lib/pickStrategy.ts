import {
  DEFAULT_PICK_STRATEGY,
  DEFAULT_SCORING_RULES,
  type PickStrategy,
} from '@shared/engine/pickStrategy.js';

export { DEFAULT_PICK_STRATEGY, DEFAULT_SCORING_RULES };
export type { PickStrategy };

export const PICK_STRATEGY_OPTIONS: Array<{ value: PickStrategy; label: string }> = [
  { value: 'likeliestScore', label: 'Likeliest score' },
  { value: 'likeliestResult', label: 'Likeliest result' },
  { value: 'maxPoints', label: 'Max points' },
  { value: 'calibrated', label: 'Calibrated' },
  { value: 'random', label: 'Random season' },
];

export const PICK_STRATEGY_HINT =
  'How a spread of simulated scorelines collapses into the single scoreline shown for each fixture.';

/** Shown under the strategy buttons so the season-level trade-off is visible before choosing. */
export const PICK_STRATEGY_DESCRIPTIONS: Record<PickStrategy, string> = {
  likeliestScore:
    'The most frequent scoreline. Draw mass concentrates on 1–1 and 0–0, so this returns far more draws than a real season has.',
  likeliestResult:
    'The most frequent result, then its most frequent scoreline. A draw is never the single likeliest result, so this returns none at all.',
  maxPoints:
    'The pick worth the most in your predictor game. Follows the likeliest result until the exact-score premium is steep enough to be worth chasing.',
  calibrated:
    'Picks the whole season at once so the win/draw/loss counts match what the simulation expects — both overall and per team.',
  random: 'One complete simulated season, replayed as it happened. Coherent, but a single draw.',
};

export const SCORING_RULES_HINT =
  'Your predictor game’s payoff. Only the ratio matters: the higher the exact-score premium, the ' +
  'more often a concentrated scoreline beats the more likely outcome.';

export function formatPickStrategy(strategy: PickStrategy): string {
  return PICK_STRATEGY_OPTIONS.find((option) => option.value === strategy)?.label ?? strategy;
}
