import { describe, expect, it } from 'vitest';

import { toLocationQuery } from './ranking.args';

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
    expect(toLocationQuery({ name: 'Lisbon', latitude: 0, longitude: 0 })).toEqual({
      fault: 'BOTH',
    });
  });

  it('refuses half a point', () => {
    expect(toLocationQuery({ latitude: 38.7 })).toEqual({ fault: 'PARTIAL_COORDINATES' });
    expect(toLocationQuery({ longitude: -9.1 })).toEqual({ fault: 'PARTIAL_COORDINATES' });
  });

  it('refuses a request that named no location at all', () => {
    expect(toLocationQuery({})).toEqual({ fault: 'EMPTY' });
    expect(toLocationQuery({ name: '   ' })).toEqual({ fault: 'EMPTY' });
  });

  it('reads the equator and the prime meridian as a point, not as an absent one', () => {
    expect(toLocationQuery({ latitude: 0, longitude: 0 })).toEqual({
      query: { kind: 'coordinates', coordinates: { latitude: 0, longitude: 0 } },
    });
  });
});
