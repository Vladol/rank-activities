import {
  type MetricValues,
  type WeatherSeries,
  channel,
  createSeries,
} from '../../src/domain/weather/weather-series';
import type { MetricCode } from '../../src/domain/weather/metric';

/**
 * Synthetic series for the unit level of docs/development-flow/stage-five.md,
 * section 12: the stages are tested on series written by hand, and only
 * `scoreActivity` as a whole meets a recorded fixture.
 */
export function hourlyTimes(date: string, hours = 24, from = 0): string[] {
  return Array.from({ length: hours }, (_, index) =>
    `${date}T${String(from + index).padStart(2, '0')}:00`,
  );
}

export function testSeries(input: {
  readonly hourlyTime: readonly string[];
  readonly hourly?: Readonly<Partial<Record<MetricCode, MetricValues>>>;
  readonly dailyTime?: readonly string[];
  readonly daily?: Readonly<Partial<Record<MetricCode, MetricValues>>>;
  readonly elevationMetres?: number;
}): WeatherSeries {
  const dailyTime = input.dailyTime ?? [...new Set(input.hourlyTime.map((slot) => slot.slice(0, 10)))];

  return createSeries({
    hourly: channel(input.hourlyTime, input.hourly ?? {}),
    daily: channel(dailyTime, input.daily ?? {}),
    provenance: [
      {
        sourceId: 'test',
        capability: 'forecast',
        gridPoint: { latitude: 0, longitude: 0, elevationMetres: input.elevationMetres ?? 0 },
        fetchedAt: '2026-09-08T00:00:00Z',
        stale: false,
        metrics: Object.keys(input.hourly ?? {}) as MetricCode[],
      },
    ],
  });
}

/** `is_day` as the provider sends it: 1 for a daylight hour, 0 for a dark one. */
export function daylightFlags(hours: number, daylight: readonly number[]): MetricValues {
  return Array.from({ length: hours }, (_, index) => (daylight.includes(index) ? 1 : 0));
}
