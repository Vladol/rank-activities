import { describe, expect, it } from 'vitest';

import { daylightFlags, hourlyTimes, testSeries } from '../../../test/support/series';
import { buildDayWindows } from './day-window';

describe('splitting a series into days', () => {
  it('takes one window per calendar day of the hourly axis', () => {
    const series = testSeries({
      hourlyTime: [...hourlyTimes('2026-01-14'), ...hourlyTimes('2026-01-15')],
    });

    expect(buildDayWindows(series).map((window) => window.date)).toEqual([
      '2026-01-14',
      '2026-01-15',
    ]);
  });

  it('indexes the hours of each day into the series axis', () => {
    const series = testSeries({
      hourlyTime: [...hourlyTimes('2026-01-14'), ...hourlyTimes('2026-01-15')],
    });
    const [first, second] = buildDayWindows(series);

    expect(first?.hourIndexes).toEqual(Array.from({ length: 24 }, (_, index) => index));
    expect(second?.hourIndexes[0]).toBe(24);
    expect(second?.hourIndexes.at(-1)).toBe(47);
  });

  it('counts the hours the day actually holds rather than assuming 24', () => {
    // A 23-hour day, which is what a spring-forward day looks like on the axis.
    const series = testSeries({ hourlyTime: hourlyTimes('2026-03-29', 23) });

    expect(buildDayWindows(series)[0]?.hoursInDay).toBe(23);
  });

  it('reads the daylight hours from is_day, not from sunrise and sunset', () => {
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14'),
      hourly: { is_day: daylightFlags(24, [8, 9, 10, 11, 12, 13, 14, 15]) },
    });

    expect(buildDayWindows(series)[0]?.daylightIndexes).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('gives a polar night an empty daylight window rather than an error', () => {
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-12-21'),
      hourly: { is_day: daylightFlags(24, []) },
      daily: { daylight_duration: [0] },
    });
    const window = buildDayWindows(series)[0];

    expect(window?.daylightIndexes).toEqual([]);
    expect(window?.daylightSeconds).toBe(0);
  });

  it('carries the daily row of the same date, so a daily metric is reachable', () => {
    const series = testSeries({
      hourlyTime: [...hourlyTimes('2026-01-14'), ...hourlyTimes('2026-01-15')],
      daily: { daylight_duration: [28800, 29000] },
    });
    const [first, second] = buildDayWindows(series);

    expect(first?.dailyIndex).toBe(0);
    expect(second?.dailyIndex).toBe(1);
    expect(second?.daylightSeconds).toBe(29000);
  });

  it('reports no daily row when the daily axis does not hold that date', () => {
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14'),
      dailyTime: ['2026-01-15'],
      daily: { daylight_duration: [29000] },
    });

    expect(buildDayWindows(series)[0]?.dailyIndex).toBeUndefined();
  });

  it('treats every hour as dark when the series carries no is_day at all', () => {
    // Absence of the flag is not daylight: a window built on a guess would put
    // a daylight aggregation on hours nobody confirmed.
    const series = testSeries({ hourlyTime: hourlyTimes('2026-01-14') });

    expect(buildDayWindows(series)[0]?.daylightIndexes).toEqual([]);
  });
});
