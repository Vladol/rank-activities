import { describe, expect, it } from 'vitest';

import {
  METRICS,
  type MetricCode,
  defineMetricDictionary,
  isMetricCode,
  metric,
  validateMetricDictionary,
} from './metric';

/**
 * The metric column of docs/development-flow/stage-three.md, section 4, in the
 * order the table lists it. This literal is the point of the test: the
 * dictionary is checked against the document, not against itself.
 */
const STAGE_THREE_METRICS = [
  'snow_depth',
  'snowfall',
  'freezing_level_height',
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'precipitation_hours',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'cloud_cover',
  'sunshine_duration',
  'visibility',
  'weather_code',
  'is_day',
  'daylight_duration',
  'sunrise',
  'sunset',
  'temperature_2m_max',
  'temperature_2m_min',
  'wave_height',
  'wave_period',
  'wave_direction',
  'sea_surface_temperature',
] as const;

describe('the metric dictionary', () => {
  it('covers exactly the metrics of stage-three.md section 4', () => {
    expect(Object.keys(METRICS).toSorted()).toEqual([...STAGE_THREE_METRICS].toSorted());
  });

  it.each(STAGE_THREE_METRICS)('%s declares a unit, a granularity and a capability', (code) => {
    const entry = metric(code as MetricCode);

    expect(entry.canonicalUnit).toBeTruthy();
    expect(['hourly', 'daily', 'both']).toContain(entry.granularity);
    expect(['forecast', 'marine', 'archive']).toContain(entry.capability);
  });

  it('serves the four wave metrics from marine and everything else from forecast', () => {
    const marine = Object.values(METRICS)
      .filter((entry) => entry.capability === 'marine')
      .map((entry) => entry.code)
      .toSorted();

    expect(marine).toEqual([
      'sea_surface_temperature',
      'wave_direction',
      'wave_height',
      'wave_period',
    ]);
  });

  it('records the canonical units that differ from the ones Open-Meteo sends', () => {
    // The three conversions of stage-three.md section 4, and the trap beside them.
    expect(metric('wind_speed_10m').canonicalUnit).toBe('m/s');
    expect(metric('wind_gusts_10m').canonicalUnit).toBe('m/s');
    expect(metric('visibility').canonicalUnit).toBe('km');
    expect(metric('snowfall').canonicalUnit).toBe('cm');
    expect(metric('snow_depth').canonicalUnit).toBe('m');
  });

  it('records the granularity the source actually offers', () => {
    expect(metric('precipitation').granularity).toBe('both');
    expect(metric('precipitation_hours').granularity).toBe('daily');
    expect(metric('cloud_cover').granularity).toBe('hourly');
  });

  it('keys every entry by its own code', () => {
    for (const [code, entry] of Object.entries(METRICS)) {
      expect(entry.code).toBe(code);
    }
  });

  it('recognises a known code and rejects an unknown one', () => {
    expect(isMetricCode('temperature_2m')).toBe(true);
    expect(isMetricCode('temperature_3m')).toBe(false);
  });
});

describe('the dictionary is validated as it is built', () => {
  it('refuses to produce a dictionary with an incomplete entry, so the import fails', () => {
    expect(() =>
      defineMetricDictionary({
        temperature_2m: {
          code: 'temperature_2m',
          granularity: 'hourly',
          capability: 'forecast',
        } as never,
      }),
    ).toThrow(/temperature_2m.*canonicalUnit/);
  });

  it('returns the dictionary unchanged when every entry is complete', () => {
    const dictionary = defineMetricDictionary({
      cloud_cover: METRICS.cloud_cover,
    });

    expect(dictionary.cloud_cover).toBe(METRICS.cloud_cover);
  });
});

describe('validateMetricDictionary', () => {
  it('accepts the shipped dictionary', () => {
    expect(() => validateMetricDictionary(METRICS)).not.toThrow();
  });

  it('refuses a dictionary whose entry has no canonical unit, so startup fails', () => {
    const broken = {
      ...METRICS,
      temperature_2m: { ...METRICS.temperature_2m, canonicalUnit: undefined },
    } as unknown as typeof METRICS;

    expect(() => validateMetricDictionary(broken)).toThrow(/temperature_2m.*canonicalUnit/);
  });

  it('refuses a dictionary whose entry has no serving capability', () => {
    const broken = {
      ...METRICS,
      wave_height: { ...METRICS.wave_height, capability: undefined },
    } as unknown as typeof METRICS;

    expect(() => validateMetricDictionary(broken)).toThrow(/wave_height.*capability/);
  });

  it('refuses a dictionary whose entry has no granularity', () => {
    const broken = {
      ...METRICS,
      visibility: { ...METRICS.visibility, granularity: undefined },
    } as unknown as typeof METRICS;

    expect(() => validateMetricDictionary(broken)).toThrow(/visibility.*granularity/);
  });
});

describe('the plausible ranges added by stage-five.md section 8', () => {
  const NUMERIC_METRICS = STAGE_THREE_METRICS.filter(
    (code) => metric(code as MetricCode).canonicalUnit !== 'iso8601',
  );

  it.each(NUMERIC_METRICS)('%s declares a physically plausible range and a kind', (code) => {
    const entry = metric(code as MetricCode);

    expect(entry.plausible).toBeDefined();
    expect(entry.plausible?.[0]).toBeLessThan(entry.plausible?.[1] ?? 0);
    expect(['continuous', 'categorical', 'flag']).toContain(entry.kind);
  });

  it('leaves the two ISO metrics without a range, because they carry no number', () => {
    expect(metric('sunrise').plausible).toBeUndefined();
    expect(metric('sunset').plausible).toBeUndefined();
  });

  it('bounds gusts below the value that would only make sense in km/h', () => {
    // The whole point of the range: 60 is a possible hurricane in m/s, and the
    // range alone cannot reject it — but a threshold of 60 written by someone
    // thinking in km/h must not load (stage-five.md, section 8).
    expect(metric('wind_gusts_10m').plausible).toEqual([0, 45]);
  });

  it('bounds visibility in kilometres, so a threshold written in metres is out of range', () => {
    expect(metric('visibility').plausible?.[1]).toBeLessThan(1000);
  });

  it('calls the WMO code categorical and the day flag a flag', () => {
    expect(metric('weather_code').kind).toBe('categorical');
    expect(metric('is_day').kind).toBe('flag');
    expect(metric('temperature_2m').kind).toBe('continuous');
  });

  it('keeps the ranges physical rather than observed', () => {
    // 1.6 m is the deepest snow the seven recorded locations hold; that does
    // not make 4 m an error (stage-five.md, section 8).
    expect(metric('snow_depth').plausible?.[1]).toBeGreaterThan(4);
  });
});
