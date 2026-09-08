import { describe, expect, it } from 'vitest';

import { compareKeys, coordinateKey, keyPaths, normaliseQuery } from './fixture-manifest';

describe('the fixture address', () => {
  it('rounds coordinates to two decimals, the rounding the cache key uses', () => {
    expect(coordinateKey(38.7167, -9.1333)).toBe('38.72:-9.13');
  });

  it('gives a nearby coordinate the same address', () => {
    expect(coordinateKey(38.7201, -9.1288)).toBe(coordinateKey(38.7167, -9.1333));
  });

  it('does not let a negative zero address a second fixture', () => {
    expect(coordinateKey(-0, -0)).toBe(coordinateKey(0, 0));
    // Everything between -0.005 and 0 rounds to "-0.00" without the fold.
    expect(coordinateKey(-0.001, -0.004)).toBe('0.00:0.00');
    expect(coordinateKey(-0.006, 0)).toBe('-0.01:0.00');
  });

  it('matches a place name regardless of case and accents', () => {
    expect(normaliseQuery('München')).toBe('munchen');
    expect(normaliseQuery(' Lisbon ')).toBe('lisbon');
  });
});

describe('the key-set comparison that guards a re-recording', () => {
  it('collapses array indices so a shorter series is not a shape change', () => {
    expect([...keyPaths({ hourly: { time: ['a', 'b'] } })]).toEqual(['hourly', 'hourly.time']);
  });

  it('reports a key that appeared and a key that vanished', () => {
    const difference = compareKeys('{"a":1,"b":2}', '{"a":1,"c":3}');

    expect(difference.appeared).toEqual(['c']);
    expect(difference.vanished).toEqual(['b']);
  });

  it('sees no difference when only values and timestamps changed', () => {
    const before = '{"hourly":{"time":["2026-09-07T00:00"],"temperature_2m":[18.1]}}';
    const after = '{"hourly":{"time":["2026-12-01T00:00"],"temperature_2m":[3.4]}}';

    expect(compareKeys(before, after)).toEqual({ appeared: [], vanished: [] });
  });

  it('treats a non-JSON recording as having no key set to compare', () => {
    expect(compareKeys('<html>403</html>', '<html>403</html>')).toEqual({
      appeared: [],
      vanished: [],
    });
  });
});
