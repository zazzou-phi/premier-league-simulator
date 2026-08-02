import { DEFAULT_CONSENSUS_MODE, type ConsensusMode } from '@shared/engine/consensus.js';

export { DEFAULT_CONSENSUS_MODE };
export type { ConsensusMode };

export const CONSENSUS_MODE_OPTIONS: Array<{ value: ConsensusMode; label: string }> = [
  { value: 'scoreline', label: 'Scoreline' },
  { value: 'outcome', label: 'Outcome' },
  { value: 'sample', label: 'Sample' },
];

export const CONSENSUS_MODE_HINT =
  'How a spread of simulated scorelines collapses into the single scoreline shown for each fixture.';

export function formatConsensusMode(mode: ConsensusMode): string {
  return CONSENSUS_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}
