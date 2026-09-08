import { describe, expect, it } from 'vitest';

import { isReasonCode } from '../../../domain/shared/reason-code';
import { toLocationQuery } from './ranking.args';

/** The fault a malformed input carries, or `undefined` when it was legible. */
function faultCodeOf(input: Parameters<typeof toLocationQuery>[0]): string | undefined {
  const read = toLocationQuery(input);

  return 'fault' in read ? read.fault.code : undefined;
}

describe('reading the location a client asked about', () => {
  it('takes a name as a name', () => {
    expect(toLocationQuery({ name: 'Lisbon' })).toEqual({
      query: { kind: 'name', name: 'Lisbon' },
    });
  });

  it('carries the language through when one was given', () => {
    expect(toLocationQuery({ name: 'Munchen', language: 'de' })).toEqual({
      query: { kind: 'name', name: 'Munchen', language: 'de' },
    });
  });

  it('takes a pair of coordinates as a point', () => {
    expect(toLocationQuery({ latitude: 38.7167, longitude: -9.1333 })).toEqual({
      query: { kind: 'coordinates', coordinates: { latitude: 38.7167, longitude: -9.1333 } },
    });
  });

  it('refuses both at once rather than picking one', () => {
    expect(faultCodeOf({ name: 'Lisbon', latitude: 0, longitude: 0 })).toBe(
      'INVALID_LOCATION_INPUT',
    );
  });

  it('refuses half a point as a malformed point, not as an absent location', () => {
    expect(faultCodeOf({ latitude: 38.7 })).toBe('INVALID_COORDINATES');
    expect(faultCodeOf({ longitude: -9.1 })).toBe('INVALID_COORDINATES');
  });

  it('refuses a request that named no location at all', () => {
    expect(faultCodeOf({})).toBe('INVALID_LOCATION_INPUT');
    expect(faultCodeOf({ name: '   ' })).toBe('INVALID_LOCATION_INPUT');
  });

  it('refuses a point that is not on Earth, with its own code and no outbound call', () => {
    // Distinct from an unresolvable name: a latitude of 999 is our caller's
    // mistake, and `LOCATION_NOT_FOUND` would make it a fact about the world.
    expect(faultCodeOf({ latitude: 999, longitude: -9.1333 })).toBe('INVALID_COORDINATES');
    expect(faultCodeOf({ latitude: 38.7, longitude: 181 })).toBe('INVALID_COORDINATES');
  });

  it('answers every fault with a code from the reason registry', () => {
    for (const input of [{}, { name: 'x', latitude: 1, longitude: 1 }, { latitude: 1 }]) {
      const code = faultCodeOf(input);

      expect(code).toBeDefined();
      expect(isReasonCode(code ?? '')).toBe(true);
    }
  });

  it('reads the equator and the prime meridian as a point, not as an absent one', () => {
    expect(toLocationQuery({ latitude: 0, longitude: 0 })).toEqual({
      query: { kind: 'coordinates', coordinates: { latitude: 0, longitude: 0 } },
    });
  });
});
