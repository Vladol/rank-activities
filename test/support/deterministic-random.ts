/**
 * A seeded generator for the property-based tests of
 * docs/development-flow/stage-five.md, section 14.4.
 *
 * Deliberately hand-rolled rather than a dependency: `03-add-activity-declaration-model`
 * adds none, and a property test that cannot be replayed from its seed is not
 * worth the run time. The same seed always yields the same sequence, so a
 * failure is reproducible from the seed printed with it.
 */
export interface DeterministicRandom {
  /** A float in [min, max). */
  between(min: number, max: number): number;
  /** An integer in [min, max]. */
  intBetween(min: number, max: number): number;
  pick<T>(values: readonly [T, ...T[]]): T;
}

export function seededRandom(seed: number): DeterministicRandom {
  // mulberry32: 32 bits of state, uniform enough for bounds and thresholds.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    between: (min, max) => min + next() * (max - min),
    intBetween: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (values) => values[Math.floor(next() * values.length)] ?? values[0],
  };
}
