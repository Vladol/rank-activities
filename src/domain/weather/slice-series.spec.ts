import { describe, expect, it } from 'vitest';

import type { WeatherSeries } from './weather-series';
import { daysCovered, sliceToDays } from './slice-series';

function series(days: number): WeatherSeries {
  const dates = Array.from({ length: days }, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`);

  return {
    hourly: {
      time: dates.flatMap((date) => [`${date}T00:00`, `${date}T01:00`]),
      values: {
        temperature_2m: dates.flatMap((_, index) => [index, null]),
      },
    },
    daily: {
      time: dates,
      values: { temperature_2m_max: dates.map((_, index) => index) },
    },
    provenance: [
      {
        sourceId: 'open-meteo-forecast',
        capability: 'forecast',
        gridPoint: { latitude: 0, longitude: 0, elevationMetres: 0 },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        stale: false,
        metrics: ['temperature_2m'],
      },
    ],
  };
}

describe('slicing a series to the days that were asked for', () => {
  it('keeps exactly the first requested days on both axes', () => {
    const sliced = sliceToDays(series(7), 3);

    expect(sliced.daily.time).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(sliced.hourly.time).toHaveLength(6);
    expect(daysCovered(sliced)).toBe(3);
  });

  it('keeps a gap a gap while it moves values', () => {
    const sliced = sliceToDays(series(7), 2);

    expect(sliced.hourly.values.temperature_2m).toEqual([0, null, 1, null]);
  });

  it('leaves a series that is already short enough untouched', () => {
    const original = series(2);

    expect(sliceToDays(original, 7)).toBe(original);
  });

  it('keeps the provenance, which is a property of the call and not of the days', () => {
    expect(sliceToDays(series(7), 1).provenance).toEqual(series(7).provenance);
  });

  it('slices an hourly-only series by its own dates', () => {
    const hourlyOnly: WeatherSeries = { ...series(4), daily: { time: [], values: {} } };

    expect(daysCovered(sliceToDays(hourlyOnly, 2))).toBe(2);
  });
});
