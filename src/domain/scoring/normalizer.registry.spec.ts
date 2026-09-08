import { describe, expect, it } from 'vitest';

import { indexByCode } from '../shared/registry';
import { NORMALIZERS, normalizerEntry, normalizerRegistry } from './normalizer.registry';

/** The six curves of docs/development-flow/stage-five.md, section 2. */
const STAGE_FIVE_NORMALIZERS = [
  'linear',
  'inverse',
  'trapezoid',
  'gaussian',
  'inverseGaussian',
  'step',
] as const;

describe('the normalizer registry', () => {
  it('holds exactly the six curves of stage-five.md section 2', () => {
    expect([...normalizerRegistry.keys()].toSorted()).toEqual([...STAGE_FIVE_NORMALIZERS].toSorted());
  });

  it.each(STAGE_FIVE_NORMALIZERS)('%s carries a parameter schema and a declared monotonicity', (code) => {
    const entry = normalizerEntry(code);

    expect(entry.code).toBe(code);
    expect(entry.params).toBeDefined();
    expect(['asc', 'desc', 'none']).toContain(entry.monotonic);
  });

  it('declares linear ascending and inverse descending', () => {
    expect(normalizerEntry('linear').monotonic).toBe('asc');
    expect(normalizerEntry('inverse').monotonic).toBe('desc');
  });

  it('refuses a duplicate code instead of letting the second entry win', () => {
    const duplicate = [...NORMALIZERS, NORMALIZERS[0]] as typeof NORMALIZERS;

    expect(() => indexByCode('normalizer', duplicate)).toThrowError(/linear/);
  });
});

describe('each entry validates its own parameters', () => {
  it('refuses a trapezoid missing b, c and d', () => {
    expect(normalizerEntry('trapezoid').params.safeParse({ a: 1 }).success).toBe(false);
  });

  it('refuses a trapezoid whose points are out of order', () => {
    const outOfOrder = normalizerEntry('trapezoid').params.safeParse({ a: 4, b: 2, c: 1, d: 0 });

    expect(outOfOrder.success).toBe(false);
  });

  it('refuses linear with from equal to to, because that is a division by zero', () => {
    expect(normalizerEntry('linear').params.safeParse({ from: 5, to: 5 }).success).toBe(false);
    expect(normalizerEntry('linear').params.safeParse({ from: 5, to: 6 }).success).toBe(true);
  });

  it('refuses a gaussian with sigma zero', () => {
    expect(normalizerEntry('gaussian').params.safeParse({ center: 20, sigma: 0 }).success).toBe(false);
    expect(normalizerEntry('gaussian').params.safeParse({ center: 20, sigma: 9 }).success).toBe(true);
  });

  it('refuses step points that do not ascend', () => {
    const descending = {
      points: [
        { at: 5, value: 1 },
        { at: 0, value: 0.2 },
      ],
      below: 0,
    };

    expect(normalizerEntry('step').params.safeParse(descending).success).toBe(false);
  });

  it('refuses an empty step', () => {
    expect(normalizerEntry('step').params.safeParse({ points: [], below: 0 }).success).toBe(false);
  });
});

describe('the axis points a declaration writes in the metric unit', () => {
  it('reports the bounds of linear and inverse', () => {
    expect(normalizerEntry('linear').axisPoints({ from: 0.2, to: 5 })).toEqual([0.2, 5]);
    expect(normalizerEntry('inverse').axisPoints({ from: 8, to: 17 })).toEqual([8, 17]);
  });

  it('reports the four corners of a trapezoid', () => {
    expect(normalizerEntry('trapezoid').axisPoints({ a: 0.1, b: 0.4, c: 2, d: 4 })).toEqual([
      0.1, 0.4, 2, 4,
    ]);
  });

  it('reports the centre of a bell but not its width', () => {
    // Sigma is a spread, not a point on the metric's axis: a plausible range
    // over the axis says nothing about it.
    expect(normalizerEntry('gaussian').axisPoints({ center: 20, sigma: 9 })).toEqual([20]);
    expect(normalizerEntry('inverseGaussian').axisPoints({ center: 20, sigma: 9 })).toEqual([20]);
  });

  it('reports where each step sits', () => {
    const params = {
      points: [
        { at: 0, value: 0.2 },
        { at: 5, value: 1 },
      ],
      below: 0,
    };

    expect(normalizerEntry('step').axisPoints(params)).toEqual([0, 5]);
  });
});
