import { describe, expect, it } from 'vitest';

import { readFixtureBody } from './fixture-files';
import { localDateAt, rebaseTimeAxis } from './time-axis-rebaser';

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFixtureBody(name)) as Record<string, unknown>;
}

interface Block {
  time: string[];
  [variable: string]: unknown;
}

describe('rebasing a fixture onto the current date', () => {
  it('moves the first day of the series onto the given date', () => {
    const recorded = fixture('chamonix-winter-ski.json');
    const rebased = rebaseTimeAxis(recorded, '2026-12-01') as { daily: Block; hourly: Block };

    expect(rebased.daily.time[0]).toBe('2026-12-01');
    expect(rebased.hourly.time[0]?.slice(0, 10)).toBe('2026-12-01');
  });

  it('preserves the length, the values and the holes', () => {
    const recorded = fixture('chamonix-winter-ski.json') as unknown as {
      hourly: Block;
      daily: Block;
    };
    const rebased = rebaseTimeAxis(recorded, '2026-12-01') as { hourly: Block; daily: Block };

    expect(rebased.hourly.time).toHaveLength(168);
    expect(rebased.hourly.temperature_2m).toEqual(recorded.hourly.temperature_2m);
    expect(rebased.hourly.visibility).toEqual(recorded.hourly.visibility);
    expect((rebased.hourly.visibility as (number | null)[]).every((v) => v === null)).toBe(true);
    expect(rebased.daily.snowfall_sum).toEqual(recorded.daily.snowfall_sum);
  });

  it('keeps the local time of day of every slot', () => {
    const recorded = fixture('lisbon-surf.json') as unknown as { hourly: Block };
    const rebased = rebaseTimeAxis(recorded, '2026-12-01') as { hourly: Block };

    for (const [index, slot] of rebased.hourly.time.entries()) {
      expect(slot.slice(11)).toBe(recorded.hourly.time[index]?.slice(11));
    }

    expect(rebased.hourly.time[14]).toContain('T14:00');
  });

  it('leaves the timezone of the recording alone', () => {
    const recorded = fixture('lisbon-surf.json');
    const rebased = rebaseTimeAxis(recorded, '2026-12-01') as Record<string, unknown>;

    for (const key of ['timezone', 'timezone_abbreviation', 'utc_offset_seconds', 'latitude', 'longitude', 'elevation']) {
      expect(rebased[key]).toEqual(recorded[key]);
    }
  });

  it('keeps the daily and the hourly axes aligned', () => {
    const rebased = rebaseTimeAxis(fixture('lisbon-surf.json'), '2026-12-01') as {
      hourly: Block;
      daily: Block;
    };

    for (const [day, date] of rebased.daily.time.entries()) {
      expect(rebased.hourly.time[day * 24]?.slice(0, 10)).toBe(date);
      expect(rebased.hourly.time[day * 24 + 23]?.slice(0, 10)).toBe(date);
    }
  });

  it('shifts sunrise and sunset by the same number of days as the rest', () => {
    const rebased = rebaseTimeAxis(fixture('lisbon-surf.json'), '2026-12-01') as { daily: Block };
    const sunrise = rebased.daily.sunrise as string[];
    const sunset = rebased.daily.sunset as string[];

    for (const [day, date] of rebased.daily.time.entries()) {
      expect(sunrise[day]?.slice(0, 10)).toBe(date);
      expect(sunset[day]?.slice(0, 10)).toBe(date);
    }
  });

  it('is a pure function: two calls for the same date are byte-identical', () => {
    const first = rebaseTimeAxis(fixture('lisbon-surf.json'), '2026-12-01');
    const second = rebaseTimeAxis(fixture('lisbon-surf.json'), '2026-12-01');

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('does not modify the fixture it was given', () => {
    const recorded = fixture('lisbon-surf.json');
    const before = JSON.stringify(recorded);

    rebaseTimeAxis(recorded, '2026-12-01');

    expect(JSON.stringify(recorded)).toBe(before);
  });

  it('is the identity when the fixture already starts on the given date', () => {
    const recorded = fixture('lisbon-surf.json') as unknown as { daily: Block };
    const today = recorded.daily.time[0] as string;

    expect(JSON.stringify(rebaseTimeAxis(recorded, today))).toBe(JSON.stringify(recorded));
  });

  it('crosses a month and a year boundary by whole days', () => {
    const rebased = rebaseTimeAxis(fixture('lisbon-surf.json'), '2026-12-29') as { daily: Block };

    expect(rebased.daily.time).toEqual([
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
    ]);
  });
});

describe('the local date at an offset', () => {
  it('reads the date of the location, not of the machine', () => {
    // 2026-09-08T23:30Z is already the 9th in Queenstown (UTC+12) and in
    // Lisbon (UTC+1), and still the 8th in New York (UTC-5).
    const instant = Date.parse('2026-09-08T23:30:00Z');

    expect(localDateAt(instant, 12 * 3600)).toBe('2026-09-09');
    expect(localDateAt(instant, 3600)).toBe('2026-09-09');
    expect(localDateAt(instant, -5 * 3600)).toBe('2026-09-08');
  });
});
