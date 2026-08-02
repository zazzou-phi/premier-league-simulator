import type { RandomSource } from '../src/engine/matchSimulator.js';

/** Deterministic linear congruential generator so simulation tests are reproducible. */
export function testRng(seed = 1): RandomSource {
  let s = seed >>> 0;
  return {
    random: () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x1_0000_0000;
    },
  };
}
