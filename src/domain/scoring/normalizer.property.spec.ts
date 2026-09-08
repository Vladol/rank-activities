import { describe, expect, it } from 'vitest';

import { type DeterministicRandom, seededRandom } from '../../../test/support/deterministic-random';
import { type NormalizerCode, normalizerEntry } from './normalizer.registry';

/**
 * The six invariants of docs/development-flow/stage-five.md, section 2, over
 * every curve in the registry. They are property-based because the faults they
 * catch — a seam discontinuity in a trapezoid, a NaN from a degenerate divisor,
 * swapped bounds — appear at particular parameter values that a table of
 * examples does not guess (stage-five.md, section 14.4).
 *
 * The generator is seeded, so a failure is replayable from the seed printed
 * beside it.
 */
const SEED = 20260908;
const PARAM_SETS = 120;
const VALUES_PER_SET = 40;
const EPSILON = 1e-6;

interface CurveUnderTest {
  readonly code: NormalizerCode;
  /** Parameters, and the axis span they are drawn over. */
  readonly params: (rng: DeterministicRandom) => { params: unknown; span: readonly [number, number] };
  /**
   * The steepest slope the generated parameters admit, used by the continuity
   * invariant. `null` for a curve that is deliberately discontinuous.
   */
  readonly lipschitz: ((params: never) => number) | null;
}

/** Two ordered bounds at least one unit apart, so no generated curve is a cliff. */
function orderedPair(rng: DeterministicRandom): [number, number] {
  const from = rng.between(-50, 50);

  return [from, from + rng.between(1, 60)];
}

const CURVES: readonly CurveUnderTest[] = [
  {
    code: 'linear',
    params: (rng) => {
      const [from, to] = orderedPair(rng);

      return { params: { from, to }, span: [from - 20, to + 20] };
    },
    lipschitz: (p: { from: number; to: number }) => 1 / Math.abs(p.to - p.from),
  },
  {
    code: 'inverse',
    params: (rng) => {
      const [from, to] = orderedPair(rng);

      return { params: { from, to }, span: [from - 20, to + 20] };
    },
    lipschitz: (p: { from: number; to: number }) => 1 / Math.abs(p.to - p.from),
  },
  {
    code: 'trapezoid',
    params: (rng) => {
      const a = rng.between(-50, 30);
      const b = a + rng.between(1, 20);
      const c = b + rng.between(0, 20);
      const d = c + rng.between(1, 20);

      return { params: { a, b, c, d }, span: [a - 15, d + 15] };
    },
    lipschitz: (p: { a: number; b: number; c: number; d: number }) =>
      Math.max(1 / (p.b - p.a), 1 / (p.d - p.c)),
  },
  {
    code: 'gaussian',
    params: (rng) => {
      const center = rng.between(-40, 40);
      const sigma = rng.between(1, 15);

      return { params: { center, sigma }, span: [center - 5 * sigma, center + 5 * sigma] };
    },
    lipschitz: (p: { sigma: number }) => 1 / (p.sigma * Math.SQRT2),
  },
  {
    code: 'inverseGaussian',
    params: (rng) => {
      const center = rng.between(-40, 40);
      const sigma = rng.between(1, 15);

      return { params: { center, sigma }, span: [center - 5 * sigma, center + 5 * sigma] };
    },
    lipschitz: (p: { sigma: number }) => 1 / (p.sigma * Math.SQRT2),
  },
  {
    code: 'step',
    params: (rng) => {
      let at = rng.between(-30, 0);
      const points = Array.from({ length: rng.intBetween(1, 5) }, () => {
        at += rng.between(1, 12);

        return { at, value: rng.between(0, 1) };
      });

      return {
        params: { points, below: rng.between(0, 1) },
        span: [(points[0]?.at ?? 0) - 10, at + 10],
      };
    },
    lipschitz: null,
  },
];

function samples(rng: DeterministicRandom, span: readonly [number, number]): number[] {
  return Array.from({ length: VALUES_PER_SET }, () => rng.between(span[0], span[1]));
}

describe.each(CURVES.map((curve) => [curve.code, curve] as const))('%s', (code, curve) => {
  const { fn, monotonic } = normalizerEntry(code);

  it('accepts every generated parameter set through its own schema', () => {
    const rng = seededRandom(SEED);
    const { params } = normalizerEntry(code);

    for (let index = 0; index < PARAM_SETS; index += 1) {
      const generated = curve.params(rng).params;

      expect(params.safeParse(generated), `seed ${SEED}, set ${index}`).toMatchObject({
        success: true,
      });
    }
  });

  it('stays inside [0, 1] and stays finite for every finite value', () => {
    const rng = seededRandom(SEED);

    for (let set = 0; set < PARAM_SETS; set += 1) {
      const { params, span } = curve.params(rng);

      for (const value of samples(rng, span)) {
        const result = fn(value, params);

        expect(Number.isFinite(result), `${code}(${value}) is not finite`).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic: the same value twice gives the same score', () => {
    const rng = seededRandom(SEED + 1);

    for (let set = 0; set < PARAM_SETS; set += 1) {
      const { params, span } = curve.params(rng);

      for (const value of samples(rng, span)) {
        expect(fn(value, params)).toBe(fn(value, params));
      }
    }
  });

  it(`respects its declared monotonicity`, () => {
    if (monotonic === 'none') {
      expect(monotonic).toBe('none');

      return;
    }

    const rng = seededRandom(SEED + 2);

    for (let set = 0; set < PARAM_SETS; set += 1) {
      const { params, span } = curve.params(rng);
      const values = samples(rng, span).toSorted((left, right) => left - right);

      for (let index = 1; index < values.length; index += 1) {
        const previous = fn(values[index - 1] ?? 0, params);
        const current = fn(values[index] ?? 0, params);

        if (monotonic === 'asc') {
          expect(current).toBeGreaterThanOrEqual(previous);
        } else {
          expect(current).toBeLessThanOrEqual(previous);
        }
      }
    }
  });

  it('is continuous where its shape is continuous', () => {
    const { lipschitz } = curve;

    if (lipschitz === null) {
      // `step` is piecewise constant by construction: a jump at a declared
      // point is the shape, not a defect.
      expect(code).toBe('step');

      return;
    }

    const rng = seededRandom(SEED + 3);

    for (let set = 0; set < PARAM_SETS; set += 1) {
      const { params, span } = curve.params(rng);
      const bound = (lipschitz as (p: unknown) => number)(params) * EPSILON + 1e-12;

      for (const value of samples(rng, span)) {
        expect(Math.abs(fn(value + EPSILON, params) - fn(value, params))).toBeLessThanOrEqual(bound);
      }
    }
  });
});

describe('the boundary values a comparison off by one would move', () => {
  it('puts a trapezoid at 0 on a and at 1 on b', () => {
    const rng = seededRandom(SEED + 4);
    const trapezoidFn = normalizerEntry('trapezoid').fn;

    for (let set = 0; set < PARAM_SETS; set += 1) {
      const a = rng.between(-50, 30);
      const b = a + rng.between(1, 20);
      const c = b + rng.between(0, 20);
      const d = c + rng.between(1, 20);
      const params = { a, b, c, d };

      expect(trapezoidFn(a, params)).toBe(0);
      expect(trapezoidFn(b, params)).toBe(1);
      expect(trapezoidFn(c, params)).toBe(1);
      expect(trapezoidFn(d, params)).toBe(0);
    }
  });

  it('puts linear at 0 on from and 1 on to, and inverse the other way round', () => {
    const rng = seededRandom(SEED + 5);

    for (let set = 0; set < PARAM_SETS; set += 1) {
      const [from, to] = orderedPair(rng);
      const params = { from, to };

      expect(normalizerEntry('linear').fn(from, params)).toBe(0);
      expect(normalizerEntry('linear').fn(to, params)).toBe(1);
      expect(normalizerEntry('inverse').fn(from, params)).toBe(1);
      expect(normalizerEntry('inverse').fn(to, params)).toBe(0);
    }
  });
});
