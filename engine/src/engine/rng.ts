import type { RandomSource } from './matchSimulator.js';

/**
 * Deterministic, well-distributed PRNG (mulberry32).
 *
 * Reproducibility is the obvious reason to want this, but distribution quality is the reason
 * it is mulberry32 rather than the one-line LCG it replaced. `samplePoisson` multiplies
 * consecutive uniforms and `sampleNormal` pairs them, so a generator whose successive outputs
 * lie on a coarse lattice biases exactly the draws the simulator depends on — and the
 * convergence harness, whose entire output *is* sampling noise, would then be measuring the
 * generator as much as the model.
 */
export function seededRandomSource(seed = 1): RandomSource {
  let state = seed >>> 0;
  return {
    random: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}
