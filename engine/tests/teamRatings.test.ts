import { describe, expect, it } from 'vitest';
import { ELO_BASE, ELO_SCALE } from '../src/engine/teamRatings.js';

describe('Elo constants', () => {
  it('exports the shared base and scale used by lambdas and in-season updates', () => {
    expect(ELO_BASE).toBe(1500);
    expect(ELO_SCALE).toBe(400);
  });
});
