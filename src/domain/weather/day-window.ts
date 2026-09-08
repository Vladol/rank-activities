import type { WeatherSeries } from './weather-series';
import { valueAt } from './weather-series';

/**
 * One day of a series, addressed by index rather than by arithmetic over time
 * (docs/development-flow/stage-four.md, section 4.2, decision 8). Nothing here
 * parses a timestamp: a day is the date prefix of the slot label, and the
 * daylight hours are the ones the provider flagged with `is_day`.
 *
 * `hoursInDay` is the length the series actually holds, never the constant 24,
 * which is what makes `shareOfHours` correct on a 23-hour day for free.
 * `daylightSeconds === 0` — the polar night — is a valid state rather than a
 * division by zero (docs/development-flow/stage-two.md, section 3).
 */
export interface DayWindow {
  /** The local date the provider labelled these slots with, `YYYY-MM-DD`. */
  readonly date: string;
  readonly hourIndexes: readonly number[];
  readonly daylightIndexes: readonly number[];
  readonly hoursInDay: number;
  readonly daylightSeconds: number;
  /** Where this date sits on the daily axis, `undefined` when it is not on it. */
  readonly dailyIndex: number | undefined;
  /** Deferred with TD-01 of stage two; every window built here is a whole day. */
  readonly partial: boolean;
}

const DATE_LENGTH = 10;

export function buildDayWindows(series: WeatherSeries): readonly DayWindow[] {
  const byDate = new Map<string, number[]>();

  series.hourly.time.forEach((slot, index) => {
    const date = slot.slice(0, DATE_LENGTH);
    const indexes = byDate.get(date);

    if (indexes === undefined) {
      byDate.set(date, [index]);
    } else {
      indexes.push(index);
    }
  });

  return [...byDate].map(([date, hourIndexes]) => {
    const dailyIndex = series.daily.time.findIndex((slot) => slot.slice(0, DATE_LENGTH) === date);
    const resolvedDailyIndex = dailyIndex === -1 ? undefined : dailyIndex;

    return {
      date,
      hourIndexes,
      daylightIndexes: hourIndexes.filter((index) => valueAt(series.hourly, 'is_day', index) === 1),
      hoursInDay: hourIndexes.length,
      daylightSeconds:
        resolvedDailyIndex === undefined
          ? 0
          : (valueAt(series.daily, 'daylight_duration', resolvedDailyIndex) ?? 0),
      dailyIndex: resolvedDailyIndex,
      partial: false,
    };
  });
}
