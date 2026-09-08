import { describe, expect, it } from 'vitest';

import { hourlyTimes, testSeries } from '../../../../test/support/series';
import {
  DERIVED_METRICS,
  type DerivedMetricCode,
  computeDerived,
  derivedMetric,
  isDerivedMetric,
  seriesContextOf,
} from './derived-metric.registry';

/** The three of docs/development-flow/stage-five.md, section 4. */
const STAGE_FIVE_DERIVED = [
  'WIND_WAVE_ALIGNMENT',
  'FRESH_COLD_SNOWFALL',
  'FREEZING_LEVEL_MARGIN',
] as const;

describe('the derived-metric registry', () => {
  it('holds exactly the three values no source returns directly', () => {
    expect(Object.keys(DERIVED_METRICS).toSorted()).toEqual([...STAGE_FIVE_DERIVED].toSorted());
  });

  it.each(STAGE_FIVE_DERIVED)('%s declares the base metrics it is computed from', (code) => {
    const definition = derivedMetric(code);

    expect(definition.requires.length).toBeGreaterThan(0);
    expect(definition.unit).toBeTruthy();
  });

  it.each(STAGE_FIVE_DERIVED)('%s is named for the quantity, never for an activity', (code) => {
    // The moment a derived metric is named after an activity is the moment the
    // next activity needing the same value copies it (design.md, Decision 7).
    expect(code.toLowerCase()).not.toMatch(/ski|surf|sightseeing|indoor|outdoor/);
  });

  it('tells a derived code from a metric-dictionary code', () => {
    expect(isDerivedMetric('WIND_WAVE_ALIGNMENT')).toBe(true);
    expect(isDerivedMetric('snow_depth')).toBe(false);
  });
});

/**
 * Open-Meteo reports both directions as the direction the flow comes *from*
 * (the meteorological convention), so offshore is a difference of about 180
 * degrees rather than about 0 (stage-five.md, section 4). The sign itself is
 * pinned by a fixture, in test/acceptance/wind-wave-alignment.spec.ts.
 */
function alignment(windDirection: number, waveDirection: number): number | null {
  const series = testSeries({
    hourlyTime: hourlyTimes('2026-01-14', 1),
    hourly: { wind_direction_10m: [windDirection], wave_direction: [waveDirection] },
  });

  return computeDerived('WIND_WAVE_ALIGNMENT', series)?.[0] ?? null;
}

describe('WIND_WAVE_ALIGNMENT', () => {

  it('is 180 when the wind blows straight against the swell', () => {
    // A west coast: swell out of the west, wind out of the east. Offshore.
    expect(alignment(90, 270)).toBeCloseTo(180, 10);
  });

  it('is 0 when the wind comes from where the swell comes from', () => {
    // Onshore: the wind runs with the wave and breaks its face.
    expect(alignment(270, 270)).toBe(0);
  });

  it('is a right angle for a cross-shore wind', () => {
    expect(alignment(180, 270)).toBeCloseTo(90, 10);
    expect(alignment(0, 270)).toBeCloseTo(90, 10);
  });

  it('never depends on which way round the compass the difference is taken', () => {
    expect(alignment(10, 350)).toBeCloseTo(20, 10);
    expect(alignment(350, 10)).toBeCloseTo(20, 10);
  });

  it('stays within 0 and 180 for every pair of directions', () => {
    for (let wind = 0; wind < 360; wind += 7) {
      for (let wave = 0; wave < 360; wave += 11) {
        const value = alignment(wind, wave);

        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(180);
      }
    }
  });

  it('has no value in a slot where either direction is missing', () => {
    expect(alignment(90, Number.NaN)).not.toBeNull();
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14', 2),
      hourly: { wind_direction_10m: [90, null], wave_direction: [270, 270] },
    });

    expect(computeDerived('WIND_WAVE_ALIGNMENT', series)).toEqual([180, null]);
  });
});

describe('FRESH_COLD_SNOWFALL', () => {
  it('keeps the snow that fell below freezing and drops the rest', () => {
    // "Snowfall yesterday at +8 C is puddles" (stage-two.md, section 6): raw
    // snowfall cannot see the difference.
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14', 4),
      hourly: { snowfall: [1.2, 0.8, 1.5, 0.4], temperature_2m: [-5, -0.1, 8, 0] },
    });

    expect(computeDerived('FRESH_COLD_SNOWFALL', series)).toEqual([1.2, 0.8, 0, 0]);
  });

  it('has no value where either the snowfall or the temperature is missing', () => {
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14', 3),
      hourly: { snowfall: [1.2, null, 1], temperature_2m: [-5, -5, null] },
    });

    expect(computeDerived('FRESH_COLD_SNOWFALL', series)).toEqual([1.2, null, null]);
  });
});

describe('FREEZING_LEVEL_MARGIN', () => {
  it('measures the freezing level against the elevation the source answered for', () => {
    // Negative is frost at the location's own elevation, positive is rain on
    // the slope while it snows higher up.
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14', 3),
      hourly: { freezing_level_height: [1200, 2500, 1000] },
      elevationMetres: 1500,
    });

    expect(computeDerived('FREEZING_LEVEL_MARGIN', series)).toEqual([-300, 1000, -500]);
  });

  it('reads the elevation from the series, never from a record about the place', () => {
    // The domain does not know geography; it knows what arrived with the data
    // (stage-five.md, section 4).
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14', 1),
      hourly: { freezing_level_height: [1200] },
      elevationMetres: 2850,
    });

    expect(seriesContextOf(series, 'freezing_level_height')).toEqual({ elevationMetres: 2850 });
    expect(computeDerived('FREEZING_LEVEL_MARGIN', series)).toEqual([-1650]);
  });
});

describe('a derived metric whose base metrics are not on the series', () => {
  it('yields no channel at all rather than a channel of zeroes', () => {
    const series = testSeries({ hourlyTime: hourlyTimes('2026-01-14', 3) });

    for (const code of STAGE_FIVE_DERIVED as readonly DerivedMetricCode[]) {
      expect(computeDerived(code, series)).toBeUndefined();
    }
  });
});
