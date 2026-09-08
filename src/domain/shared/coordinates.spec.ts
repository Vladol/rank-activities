import { describe, expect, it } from 'vitest';

import { GRID_DECIMALS, isOnEarth, locationId, roundToGrid } from './coordinates';

describe('rounding a coordinate onto the grid', () => {
  it('keeps the two decimals the source grid justifies', () => {
    expect(roundToGrid(46.204391)).toBe('46.20');
    expect(GRID_DECIMALS).toBe(2);
  });

  it('folds negative zero away, so a point just west of Greenwich is not a second place', () => {
    expect(roundToGrid(-0.0031)).toBe('0.00');
    expect(roundToGrid(-0)).toBe('0.00');
  });
});

describe('the identity of a place', () => {
  it('is a pure function of the rounded coordinates', () => {
    expect(locationId({ latitude: 38.7167, longitude: -9.1333 })).toBe('38.72,-9.13');
  });

  it('is the same value on every call, so it survives a restart', () => {
    const first = locationId({ latitude: 50.0875, longitude: 14.4213 });
    const second = locationId({ latitude: 50.0875, longitude: 14.4213 });

    expect(first).toBe(second);
    expect(first).toBe('50.09,14.42');
  });

  it('gives two points a few hundred metres apart one identity', () => {
    const west = locationId({ latitude: 46.2044, longitude: 6.1432 });
    const east = locationId({ latitude: 46.2001, longitude: 6.1449 });

    expect(west).toBe(east);
  });

  it('keeps two places the grid can tell apart distinct', () => {
    expect(locationId({ latitude: 46.2044, longitude: 6.1432 })).not.toBe(
      locationId({ latitude: 46.2144, longitude: 6.1432 }),
    );
  });
});

describe('coordinates that name no point on Earth', () => {
  it.each([
    ['a latitude past the pole', 999, -9.1333],
    ['a latitude just past the south pole', -90.01, 0],
    ['a longitude past the date line', 0, 180.01],
    ['a latitude that is not a number', Number.NaN, 0],
    ['a longitude that is infinite', 0, Number.POSITIVE_INFINITY],
  ])('rejects %s', (_case, latitude, longitude) => {
    expect(isOnEarth({ latitude, longitude })).toBe(false);
  });

  it.each([
    ['the poles', 90, 180],
    ['the antimeridian', -90, -180],
    ['the null island', 0, 0],
  ])('accepts %s', (_case, latitude, longitude) => {
    expect(isOnEarth({ latitude, longitude })).toBe(true);
  });
});

