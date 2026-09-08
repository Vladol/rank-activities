import { describe, expect, it } from 'vitest';

import { gaussian } from './gaussian';
import { inverse } from './inverse';
import { inverseGaussian } from './inverse-gaussian';
import { linear } from './linear';
import { step } from './step';
import { trapezoid } from './trapezoid';

/**
 * The six curves of docs/development-flow/stage-five.md, section 2, as pure
 * functions. Each is named for its shape: a curve named after an activity
 * would mean the calculation had started leaking into code.
 */
describe('linear{from, to}', () => {
  it('is 0 at from, 1 at to and proportional between them', () => {
    expect(linear(0, { from: 0, to: 20 })).toBe(0);
    expect(linear(20, { from: 0, to: 20 })).toBe(1);
    expect(linear(5, { from: 0, to: 20 })).toBe(0.25);
  });

  it('clamps unconditionally, because there is no clamp parameter', () => {
    expect(linear(-4, { from: 0, to: 20 })).toBe(0);
    expect(linear(40, { from: 0, to: 20 })).toBe(1);
  });

  it('reads a window that does not start at zero', () => {
    // outdoor sightseeing, dryHours: linear{0.4, 1.0} over a share of hours.
    expect(linear(0.7, { from: 0.4, to: 1 })).toBeCloseTo(0.5, 10);
  });
});

describe('inverse{from, to}', () => {
  it('is 1 at from, 0 at to and falls between them', () => {
    expect(inverse(8, { from: 8, to: 17 })).toBe(1);
    expect(inverse(17, { from: 8, to: 17 })).toBe(0);
    expect(inverse(12.5, { from: 8, to: 17 })).toBeCloseTo(0.5, 10);
  });

  it('clamps on both sides', () => {
    expect(inverse(0, { from: 8, to: 17 })).toBe(1);
    expect(inverse(40, { from: 8, to: 17 })).toBe(0);
  });

  it('accepts a window that runs through negative values', () => {
    // ski, freezingMargin: inverse{-300, 300} in metres.
    expect(inverse(0, { from: -300, to: 300 })).toBeCloseTo(0.5, 10);
    expect(inverse(-400, { from: -300, to: 300 })).toBe(1);
  });
});

describe('trapezoid{a, b, c, d}', () => {
  const skiSnow = { a: 0.1, b: 0.4, c: 2, d: 4 };

  it('is 0 at a, 1 at b and 1 across the plateau', () => {
    expect(trapezoid(0.1, skiSnow)).toBe(0);
    expect(trapezoid(0.4, skiSnow)).toBe(1);
    expect(trapezoid(1.2, skiSnow)).toBe(1);
    expect(trapezoid(2, skiSnow)).toBe(1);
  });

  it('is 0 outside a and d', () => {
    expect(trapezoid(0.05, skiSnow)).toBe(0);
    expect(trapezoid(4, skiSnow)).toBe(0);
    expect(trapezoid(6, skiSnow)).toBe(0);
  });

  it('rises and falls linearly on the two ramps', () => {
    // Off the midpoint of each ramp on purpose: 0.5 is the one value an
    // inverted ramp would still reproduce.
    expect(trapezoid(0.25, skiSnow)).toBeCloseTo(0.5, 10);
    expect(trapezoid(0.175, skiSnow)).toBeCloseTo(0.25, 10);
    expect(trapezoid(3, skiSnow)).toBeCloseTo(0.5, 10);
    expect(trapezoid(2.5, skiSnow)).toBeCloseTo(0.75, 10);
  });

  it('reads a plateau that runs through zero', () => {
    // ski, temperature: trapezoid{-20, -8, -2, 4} in degrees Celsius.
    const skiTemp = { a: -20, b: -8, c: -2, d: 4 };

    expect(trapezoid(-5, skiTemp)).toBe(1);
    expect(trapezoid(-20, skiTemp)).toBe(0);
    expect(trapezoid(1, skiTemp)).toBeCloseTo(0.5, 10);
  });

  it('degenerates into a step up when a equals b', () => {
    expect(trapezoid(1, { a: 1, b: 1, c: 3, d: 4 })).toBe(1);
    expect(trapezoid(0.999, { a: 1, b: 1, c: 3, d: 4 })).toBe(0);
  });

  it('degenerates into a cliff down when c equals d', () => {
    expect(trapezoid(3, { a: 1, b: 2, c: 3, d: 3 })).toBe(1);
    expect(trapezoid(3.001, { a: 1, b: 2, c: 3, d: 3 })).toBe(0);
  });
});

describe('gaussian{center, sigma}', () => {
  it('is 1 at the centre', () => {
    expect(gaussian(20, { center: 20, sigma: 9 })).toBe(1);
  });

  it('falls symmetrically and never reaches zero', () => {
    const params = { center: 20, sigma: 9 };
    const below = gaussian(11, params);

    expect(below).toBeCloseTo(gaussian(29, params), 12);
    expect(below).toBeCloseTo(Math.exp(-0.5), 12);
    expect(gaussian(200, params)).toBeGreaterThan(0);
  });
});

describe('inverseGaussian{center, sigma}', () => {
  it('is 0 at the centre and approaches 1 far from it', () => {
    // indoor sightseeing, discomfort: comfort at +20 C, the museum wins far from it.
    expect(inverseGaussian(20, { center: 20, sigma: 9 })).toBe(0);
    expect(inverseGaussian(45, { center: 20, sigma: 9 })).toBeGreaterThan(0.9);
    expect(inverseGaussian(-10, { center: 20, sigma: 9 })).toBeGreaterThan(0.9);
  });

  it('is the exact complement of gaussian', () => {
    const params = { center: 20, sigma: 9 };

    for (const value of [-30, 0, 14, 20, 33, 51]) {
      expect(inverseGaussian(value, params)).toBeCloseTo(1 - gaussian(value, params), 12);
    }
  });
});

describe('step{points, below}', () => {
  const params = { points: [{ at: 0, value: 0.2 }, { at: 5, value: 0.6 }, { at: 10, value: 1 }], below: 0 };

  it('takes the value of the last point at or below the value', () => {
    expect(step(0, params)).toBe(0.2);
    expect(step(4.9, params)).toBe(0.2);
    expect(step(5, params)).toBe(0.6);
    expect(step(9.9, params)).toBe(0.6);
    expect(step(10, params)).toBe(1);
    expect(step(1000, params)).toBe(1);
  });

  it('takes the below value under the first point', () => {
    expect(step(-0.1, params)).toBe(0);
  });
});
