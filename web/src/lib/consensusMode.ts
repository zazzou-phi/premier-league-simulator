import {
  DEFAULT_CONSENSUS_MODE,
  DEFAULT_PREDICTOR_POINTS,
  type ConsensusMode,
} from '@shared/engine/consensus.js';

export { DEFAULT_CONSENSUS_MODE, DEFAULT_PREDICTOR_POINTS };
export type { ConsensusMode };

export const CONSENSUS_MODE_OPTIONS: Array<{ value: ConsensusMode; label: string }> = [
  { value: 'scoreline', label: 'Scoreline' },
  { value: 'outcome', label: 'Outcome' },
  { value: 'expectedPoints', label: 'Predictor' },
  { value: 'sample', label: 'Sample' },
];

export const CONSENSUS_MODE_HINT =
  'How a spread of simulated scorelines collapses into the single scoreline shown for each fixture.';

export const PREDICTOR_POINTS_HINT =
  'Your predictor game’s payoff. Only the ratio matters: the higher the exact-score premium, the ' +
  'more often a concentrated scoreline beats the more likely outcome.';

export function formatConsensusMode(mode: ConsensusMode): string {
  return CONSENSUS_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}
