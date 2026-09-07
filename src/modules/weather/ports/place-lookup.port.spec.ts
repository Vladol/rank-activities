import { describe, expect, it } from 'vitest';

import { parsePlaceLookupResponse } from './place-lookup.port';

/** Trimmed from docs/investigation/open-meteo/samples/geocoding-lisbon.json. */
const LISBON_BODY = {
  results: [
    {
      id: 2267057,
      name: 'Lisbon',
      latitude: 38.72509,
      longitude: -9.1498,
      elevation: 68,
      feature_code: 'PPLC',
      country_code: 'PT',
      timezone: 'Europe/Lisbon',
      population: 517802,
      country: 'Portugal',
      admin1: 'Lisbon District',
    },
    {
      id: 5160951,
      name: 'Lisbon',
      latitude: 40.772,
      longitude: -80.76813,
      elevation: 294,
      country_code: 'US',
      timezone: 'America/New_York',
      population: 2727,
      country: 'United States',
      admin1: 'Ohio',
    },
  ],
  generationtime_ms: 0.9,
};

/** docs/investigation/open-meteo/samples/geocoding-not-found.json, in full. */
const NOT_FOUND_BODY = { generationtime_ms: 0.68449974 };

describe('a lookup that found nothing', () => {
  it('parses a body with no results key as an empty result, not a failure', () => {
    const parsed = parsePlaceLookupResponse(NOT_FOUND_BODY);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toEqual([]);
  });

  it('parses an explicitly empty result list the same way', () => {
    const parsed = parsePlaceLookupResponse({ results: [], generationtime_ms: 0.4 });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toEqual([]);
  });
});

describe('a lookup that found candidates', () => {
  it('returns them in the order the source offered them', () => {
    const parsed = parsePlaceLookupResponse(LISBON_BODY);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.map((candidate) => candidate.admin1)).toEqual([
      'Lisbon District',
      'Ohio',
    ]);
  });

  it('carries coordinates, time zone, elevation and population', () => {
    const parsed = parsePlaceLookupResponse(LISBON_BODY);
    const first = parsed.ok ? parsed.value[0] : undefined;

    expect(first).toEqual({
      sourcePlaceId: '2267057',
      name: 'Lisbon',
      latitude: 38.72509,
      longitude: -9.1498,
      elevationMetres: 68,
      timezone: 'Europe/Lisbon',
      population: 517802,
      countryCode: 'PT',
      admin1: 'Lisbon District',
    });
  });

  it('accepts a candidate the source gave no population for', () => {
    const parsed = parsePlaceLookupResponse({
      results: [
        {
          id: 1,
          name: 'Hamlet',
          latitude: 1,
          longitude: 2,
          elevation: 3,
          timezone: 'Europe/Lisbon',
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value[0]?.population).toBeUndefined();
  });
});

describe('a body that is not a lookup response', () => {
  it('is a schema mismatch rather than an empty result', () => {
    const parsed = parsePlaceLookupResponse({ results: [{ name: 'Lisbon' }] });

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.code).toBe('SCHEMA_MISMATCH');
  });

  it('rejects a body that is not an object at all', () => {
    expect(parsePlaceLookupResponse('<html>403</html>').ok).toBe(false);
    expect(parsePlaceLookupResponse(null).ok).toBe(false);
  });

  it('is returned rather than thrown', () => {
    expect(() => parsePlaceLookupResponse(undefined)).not.toThrow();
  });

  it('does not copy the source body into the error', () => {
    const parsed = parsePlaceLookupResponse({ error: true, reason: 'Cannot initialize Swift type' });

    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain('Swift');
  });
});
