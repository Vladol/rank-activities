import { describe, expect, it } from 'vitest';

import type { WeatherSeries } from '../../domain/weather/weather-series';
import type { PlaceCandidate } from '../../modules/weather/ports/place-lookup.port';
import { CACHE_CODECS, type Codec, weatherSeriesCodec } from './codecs';

/**
 * A series with a hole in it. The hole is the whole point: Open-Meteo returns
 * `null` inside its hourly channels routinely, and a `null` that comes back as
 * a `0` is a value the scoring will happily use.
 */
const seriesWithGaps: WeatherSeries = {
  hourly: {
    time: ['2026-01-01T00:00', '2026-01-01T01:00', '2026-01-01T02:00'],
    values: {
      temperature_2m: [1.5, null, -0.5],
      wind_speed_10m: [null, null, null],
    },
  },
  daily: {
    time: ['2026-01-01'],
    values: { temperature_2m_max: [3] },
  },
  provenance: [
    {
      sourceId: 'open-meteo-forecast',
      capability: 'forecast',
      gridPoint: { latitude: 45.92, longitude: 6.87, elevationMetres: 1035 },
      fetchedAt: '2026-01-01T00:00:00.000Z',
      stale: false,
      metrics: ['temperature_2m', 'wind_speed_10m'],
      timezone: 'Europe/Paris',
    },
  ],
};

const candidates: readonly PlaceCandidate[] = [
  {
    sourcePlaceId: '2267057',
    name: 'Lisbon',
    latitude: 38.72,
    longitude: -9.13,
    elevationMetres: 10,
    timezone: 'Europe/Lisbon',
    population: 517802,
    countryCode: 'PT',
  },
];

/** One sample per codec; the suite refuses a codec that has none. */
const SAMPLES: Readonly<Record<keyof typeof CACHE_CODECS, unknown[]>> = {
  'weather-series': [seriesWithGaps, { ...seriesWithGaps, hourly: { time: [], values: {} } }],
  'place-candidates': [candidates, []],
};

describe('a cached value survives the crossing unchanged', () => {
  it('has a codec and a sample for every cached type', () => {
    expect(Object.keys(SAMPLES).toSorted()).toEqual(Object.keys(CACHE_CODECS).toSorted());
  });

  for (const [name, codec] of Object.entries(CACHE_CODECS) as [
    keyof typeof CACHE_CODECS,
    Codec<unknown>,
  ][]) {
    it(`round-trips every sample of ${name} through text`, () => {
      for (const sample of SAMPLES[name]) {
        const decoded = codec.decode(JSON.parse(JSON.stringify(codec.encode(sample))));

        expect(decoded).toStrictEqual(sample);
      }
    });

    it(`stores ${name} as plain data only`, () => {
      for (const sample of SAMPLES[name]) {
        expectPlainData(codec.encode(sample));
      }
    });
  }

  // The failure this whole contract exists to prevent, stated as its own test
  // rather than left implicit in a structural comparison.
  it('keeps a missing hour missing rather than turning it into zero', () => {
    const decoded = weatherSeriesCodec.decode(
      JSON.parse(JSON.stringify(weatherSeriesCodec.encode(seriesWithGaps))),
    );

    expect(decoded?.hourly.values.temperature_2m).toEqual([1.5, null, -0.5]);
    expect(decoded?.hourly.values.wind_speed_10m).toEqual([null, null, null]);
  });

  it('reads a payload it does not recognise as a miss, not as a partial value', () => {
    expect(weatherSeriesCodec.decode({ hourly: { time: [] } })).toBeUndefined();
    expect(weatherSeriesCodec.decode('not an object')).toBeUndefined();
    // An axis of three against two values is our own bug; it must not come back
    // from the cache as an off-by-one.
    expect(
      weatherSeriesCodec.decode({
        hourly: { time: ['a', 'b', 'c'], values: { temperature_2m: [1, 2] } },
        daily: { time: [], values: {} },
        provenance: seriesWithGaps.provenance,
      }),
    ).toBeUndefined();
  });
});

/**
 * Numbers, strings, booleans, `null`, arrays and plain objects. Anything with
 * behaviour — a method, a `Map`, a `Date`, a class instance — is refused here,
 * because it survives an in-memory cache and dies in a shared one.
 */
function expectPlainData(value: unknown, path = '$'): void {
  if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => expectPlainData(entry, `${path}[${index}]`));

    return;
  }

  expect(typeof value, `${path} carries behaviour`).toBe('object');
  expect(Object.getPrototypeOf(value), `${path} is not a plain object`).toBe(Object.prototype);

  for (const [key, entry] of Object.entries(value as object)) {
    expectPlainData(entry, `${path}.${key}`);
  }
}
