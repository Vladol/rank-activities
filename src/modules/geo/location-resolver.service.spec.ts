import { describe, expect, it } from 'vitest';

import { FakePlaceLookup, placeCandidate } from '../../../test/support/fake-place-lookup';
import { domainError } from '../../domain/shared/domain-error';
import { isReasonCode } from '../../domain/shared/reason-code';
import { recordedPlaceLookupSource } from '../weather/adapters/mock/recorded-sources';
import { LocationResolverService } from './location-resolver.service';

const MOSCOW_RU = placeCandidate({
  sourcePlaceId: '524901',
  name: 'Moscow',
  latitude: 55.75204,
  longitude: 37.61781,
  elevationMetres: 155,
  timezone: 'Europe/Moscow',
  population: 10_381_222,
  countryCode: 'RU',
  admin1: 'Moscow',
});

const MOSCOW_ID = placeCandidate({
  sourcePlaceId: '5601538',
  name: 'Moscow',
  latitude: 46.73239,
  longitude: -117.00017,
  elevationMetres: 786,
  timezone: 'America/Los_Angeles',
  population: 25_060,
  countryCode: 'US',
  admin1: 'Idaho',
});

describe('resolving a place name', () => {
  it('carries coordinates, a time zone, an elevation and the country', async () => {
    const lookup = FakePlaceLookup.returning([MOSCOW_RU]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Moscow',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coordinates).toEqual({ latitude: 55.75204, longitude: 37.61781 });
    expect(result.value.timezone).toBe('Europe/Moscow');
    expect(result.value.elevationMetres).toBe(155);
    expect(result.value.place?.countryCode).toBe('RU');
  });

  it('turns an empty lookup result into the not-found reason, which the port never states', async () => {
    const lookup = FakePlaceLookup.returning([]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Zzzqqxwv',
    });

    // The port answered `ok([])`: a miss is not a port failure
    // (stage-three.md, section 6). Naming it is this service's job.
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('LOCATION_NOT_FOUND');
  });

  it('substitutes no nearest match for an unknown name', async () => {
    const lookup = FakePlaceLookup.returning([]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Zzzqqxwv',
    });

    expect(JSON.stringify(result)).not.toContain('latitude');
  });

  it('fails as retryable when the lookup itself is unavailable, guessing no coordinates', async () => {
    const lookup = FakePlaceLookup.failing(
      domainError('UNEXPECTED_CONTENT_TYPE', 'the lookup answered with an nginx page'),
    );
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'München',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('latitude');
  });

  it('names every failure with a reason the client already knows', async () => {
    const lookup = FakePlaceLookup.returning([]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Zzzqqxwv',
    });

    expect(result.ok ? true : isReasonCode(result.error.code)).toBe(true);
  });
});

describe('a name that matches several places', () => {
  it('chooses the most populous candidate rather than the first offered', async () => {
    // Offered smallest first, so "the first one" and "the largest one" differ.
    const lookup = FakePlaceLookup.returning([MOSCOW_ID, MOSCOW_RU]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Moscow',
    });

    expect(result.ok ? result.value.coordinates.latitude : undefined).toBe(55.75204);
  });

  it('discloses the chosen place, its country and its administrative region', async () => {
    const lookup = FakePlaceLookup.returning([MOSCOW_ID, MOSCOW_RU]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Moscow',
    });

    expect(result.ok ? result.value.place : undefined).toMatchObject({
      name: 'Moscow',
      countryCode: 'RU',
      admin1: 'Moscow',
    });
  });

  it('treats a candidate with no population as the smallest, never as unranked', async () => {
    const unpopulated = placeCandidate({ sourcePlaceId: '9', latitude: 1, longitude: 1 });
    const lookup = FakePlaceLookup.returning([unpopulated, MOSCOW_ID]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Moscow',
    });

    expect(result.ok ? result.value.place?.admin1 : undefined).toBe('Idaho');
  });
});

describe('resolving coordinates', () => {
  it('follows the same path without a name lookup', async () => {
    const lookup = FakePlaceLookup.returning([MOSCOW_RU]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'coordinates',
      coordinates: { latitude: 38.7167, longitude: -9.1333 },
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.id : undefined).toBe('38.72,-9.13');
    expect(lookup.queries).toEqual([]);
  });

  it('puts the series on the local axis it cannot name, rather than on GMT', async () => {
    const result = await new LocationResolverService(FakePlaceLookup.returning([])).resolve({
      kind: 'coordinates',
      coordinates: { latitude: 38.7167, longitude: -9.1333 },
    });

    // Omitting a timezone silently returns GMT (stage-three.md, section 2.2).
    expect(result.ok ? result.value.timezone : undefined).toBe('auto');
    expect(result.ok ? result.value.elevationMetres : 0).toBeNull();
  });

  it('rejects coordinates outside the valid range before any outbound call', async () => {
    const lookup = FakePlaceLookup.returning([MOSCOW_RU]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'coordinates',
      coordinates: { latitude: 999, longitude: -9.1333 },
    });

    expect(result.ok ? undefined : result.error.code).toBe('INVALID_COORDINATES');
    expect(lookup.queries).toEqual([]);
  });

  it('rejects coordinates a lookup itself offered, wherever they came from', async () => {
    const lookup = FakePlaceLookup.returning([placeCandidate({ latitude: 999, longitude: 0 })]);
    const result = await new LocationResolverService(lookup).resolve({
      kind: 'name',
      name: 'Nowhere',
    });

    expect(result.ok ? undefined : result.error.code).toBe('INVALID_COORDINATES');
  });
});

describe('one place under several spellings', () => {
  it('resolves all of them to the same coordinates and the same identity', async () => {
    const resolver = new LocationResolverService(recordedPlaceLookupSource());
    const spellings = ['Lisbon', 'lisbon', '  LISBON  '];

    const resolved = await Promise.all(
      spellings.map((name) => resolver.resolve({ kind: 'name', name })),
    );

    const identities = new Set(resolved.map((one) => (one.ok ? one.value.id : one.error.code)));

    expect(identities).toEqual(new Set(['38.73,-9.15']));
  });
});
