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
