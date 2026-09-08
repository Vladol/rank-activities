import { describe, expect, it } from 'vitest';

import { daylightFlags, hourlyTimes, testSeries } from '../../../../test/support/series';
import { buildDayWindows } from '../day-window';
import { aggregatorEntry, aggregatorRegistry } from './aggregator.registry';
import type { MetricChannel } from './aggregator.registry';

/** The eight strategies of docs/development-flow/stage-five.md, section 3. */
const STAGE_FIVE_AGGREGATIONS = [
  'mean',
  'max',
  'min',
  'sum',
  'identity',
  'daylightWindow',
  'shareOfHours',
  'countIf',
] as const;

function day(hourly: readonly (number | null)[], options: { daylight?: readonly number[] } = {}) {
  const series = testSeries({
    hourlyTime: hourlyTimes('2026-01-14', hourly.length),
    hourly: {
      temperature_2m: hourly,
      ...(options.daylight === undefined
        ? {}
        : { is_day: daylightFlags(hourly.length, options.daylight) }),
    },
    daily: { precipitation_hours: [12] },
  });

  const window = buildDayWindows(series)[0];

  if (window === undefined) {
    throw new Error('The fixture must hold one day.');
  }

  return {
    window,
    channel: { values: hourly, unit: 'degC' } as MetricChannel,
    dailyChannel: { values: [12], unit: 'hour' } as MetricChannel,
  };
}

describe('the aggregation registry', () => {
  it('holds exactly the eight strategies of stage-five.md section 3', () => {
    expect([...aggregatorRegistry.keys()].toSorted()).toEqual(
      [...STAGE_FIVE_AGGREGATIONS].toSorted(),
    );
  });

  it.each(STAGE_FIVE_AGGREGATIONS)('%s declares which channel it reads from', (code) => {
    expect(['hourly', 'daily']).toContain(aggregatorEntry(code).granularity);
  });

  it('reads the ready-made daily field with identity and everything else hourly', () => {
    expect(aggregatorEntry('identity').granularity).toBe('daily');
    expect(aggregatorEntry('mean').granularity).toBe('hourly');
    expect(aggregatorEntry('daylightWindow').granularity).toBe('hourly');
  });
});

describe('the four reducers over a day', () => {
  const { window, channel } = day([1, 2, null, 4]);

  it.each([
    ['mean', 7 / 3],
    ['max', 4],
    ['min', 1],
    ['sum', 7],
  ] as const)('%s ignores the empty slots', (code, expected) => {
    expect(aggregatorEntry(code).fn(channel, window, {})?.value).toBeCloseTo(expected, 10);
  });

  it('reports how many slots contributed and how many were empty', () => {
    expect(aggregatorEntry('mean').fn(channel, window, {})).toMatchObject({
      sampleCount: 3,
      missingCount: 1,
      unit: 'degC',
    });
  });

  it('returns no value at all when every slot of the day is empty', () => {
    const empty = day([null, null, null]);

    expect(aggregatorEntry('mean').fn(empty.channel, empty.window, {})).toBeNull();
    expect(aggregatorEntry('sum').fn(empty.channel, empty.window, {})).toBeNull();
  });

  it('never confuses a sum of zero with an absent value', () => {
    // 0 mm of precipitation is data. An absent channel is not.
    const dry = day([0, 0, 0, 0]);

    expect(aggregatorEntry('sum').fn(dry.channel, dry.window, {})).toMatchObject({
      value: 0,
      sampleCount: 4,
    });
  });
});

describe('identity, over the daily channel the provider already aggregated', () => {
  it('takes the value of the day', () => {
    const { window, dailyChannel } = day([1, 2, 3]);

    expect(aggregatorEntry('identity').fn(dailyChannel, window, {})).toMatchObject({
      value: 12,
      sampleCount: 1,
      missingCount: 0,
      unit: 'hour',
    });
  });

  it('returns no value when the daily axis does not hold that day', () => {
    const series = testSeries({
      hourlyTime: hourlyTimes('2026-01-14', 3),
      dailyTime: ['2026-01-15'],
      daily: { precipitation_hours: [12] },
    });
    const window = buildDayWindows(series)[0];

    expect(
      aggregatorEntry('identity').fn(
        { values: [12], unit: 'hour' },
        window ?? { ...day([1]).window },
        {},
      ),
    ).toBeNull();
  });
});

describe('daylightWindow, over the hours the provider flagged as light', () => {
  it('reduces only the daylight hours', () => {
    const { window, channel } = day([0, 10, 20, 30], { daylight: [1, 2] });

    expect(aggregatorEntry('daylightWindow').fn(channel, window, { reduce: 'mean' })).toMatchObject({
      value: 15,
      sampleCount: 2,
    });
    expect(aggregatorEntry('daylightWindow').fn(channel, window, { reduce: 'max' })?.value).toBe(20);
  });

  it('returns no value on a day with no daylight at all, never a non-numeric one', () => {
    // Tromso in December. The outcome is then decided by a constraint or a null
    // policy, never by an arithmetic error (stage-five.md, section 3).
    const { window, channel } = day([-4, -5, -6, -7], { daylight: [] });
    const result = aggregatorEntry('daylightWindow').fn(channel, window, { reduce: 'mean' });

    expect(result).toBeNull();
  });
});

describe('shareOfHours', () => {
  it('divides by the hours the series actually holds for that day', () => {
    // 23 hours on the axis: the denominator is 23, not 24.
    const hours = Array.from({ length: 23 }, (_, index) => (index < 18 ? 0 : 1));
    const { window, channel } = day(hours);

    const result = aggregatorEntry('shareOfHours').fn(channel, window, {
      predicate: { op: 'lt', value: 0.1 },
      window: 'day',
    });

    expect(window.hoursInDay).toBe(23);
    expect(result?.value).toBeCloseTo(18 / 23, 10);
    expect(result?.unit).toBe('ratio');
  });

  it('divides by the daylight hours when the window is the daylight one', () => {
    const { window, channel } = day([1, 0, 0, 1], { daylight: [1, 2, 3] });

    const result = aggregatorEntry('shareOfHours').fn(channel, window, {
      predicate: { op: 'lt', value: 0.1 },
      window: 'daylight',
    });

    expect(result?.value).toBeCloseTo(2 / 3, 10);
  });

  it('divides by the slots that hold a value, not by the empty ones', () => {
    const { window, channel } = day([0, 0, null, 1]);

    const result = aggregatorEntry('shareOfHours').fn(channel, window, {
      predicate: { op: 'lt', value: 0.1 },
      window: 'day',
    });

    expect(result).toMatchObject({ sampleCount: 3, missingCount: 1 });
    expect(result?.value).toBeCloseTo(2 / 3, 10);
  });
});

describe('countIf', () => {
  it('counts the hours matching the predicate, in hours', () => {
    const { window, channel } = day([95, 3, 96, 3]);

    expect(
      aggregatorEntry('countIf').fn(channel, window, {
        predicate: { op: 'in', value: [95, 96] },
        window: 'day',
      }),
    ).toMatchObject({ value: 2, unit: 'hour', sampleCount: 4, missingCount: 0 });
  });

  it('counts zero rather than returning nothing when the day holds values but none match', () => {
    const { window, channel } = day([3, 3, 3]);

    expect(
      aggregatorEntry('countIf').fn(channel, window, {
        predicate: { op: 'in', value: [95, 96] },
        window: 'day',
      })?.value,
    ).toBe(0);
  });
});

describe('the parameter schemas', () => {
  it('refuses a daylightWindow reduce that is not one of the four', () => {
    expect(aggregatorEntry('daylightWindow').params.safeParse({ reduce: 'median' }).success).toBe(
      false,
    );
    expect(aggregatorEntry('daylightWindow').params.safeParse({ reduce: 'mean' }).success).toBe(true);
  });

  it('requires a predicate and a window for shareOfHours', () => {
    expect(aggregatorEntry('shareOfHours').params.safeParse({}).success).toBe(false);
    expect(
      aggregatorEntry('shareOfHours').params.safeParse({
        predicate: { op: 'lt', value: 0.1 },
        window: 'daylight',
      }).success,
    ).toBe(true);
  });

  it('takes no parameters for the four plain reducers', () => {
    expect(aggregatorEntry('mean').params.safeParse({}).success).toBe(true);
    expect(aggregatorEntry('mean').params.safeParse(undefined).success).toBe(true);
  });
});
