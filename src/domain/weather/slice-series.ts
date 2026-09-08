import type { MetricCode } from './metric';
import type { MetricValues, SeriesChannel, WeatherSeries } from './weather-series';

const DATE_LENGTH = 'YYYY-MM-DD'.length;

/**
 * Narrows a series to its first whole local days.
 *
 * It exists because the cache asks the source for the longest horizon it ever
 * needs and answers every shorter question from that one entry: keying by the
 * requested days produced two misses on identical data, since the longer
 * answer contains the shorter one
 * (`07-add-source-caching-and-resilience`, design.md Decision 2).
 *
 * The day is the local date the source put on the axis, never a count of
 * hours: the axis carries `auto`-resolved local time, and slicing by position
 * would cut a different place at a different hour.
 */
export function sliceToDays(series: WeatherSeries, days: number): WeatherSeries {
  if (days <= 0) {
    return series;
  }

  const dates = distinctDates(
    series.daily.time.length > 0 ? series.daily.time : series.hourly.time,
  );

  // Nothing to drop: the same object rather than an equal one, so a caller can
  // still tell a sliced answer from an untouched one.
  if (dates.length === 0 || days >= dates.length) {
    return series;
  }

  const kept = new Set(dates.slice(0, days));

  return {
    hourly: keepDates(series.hourly, kept),
    daily: keepDates(series.daily, kept),
    provenance: series.provenance,
  };
}

/** How many whole local days a series covers, by its own axis. */
export function daysCovered(series: WeatherSeries): number {
  const axis = series.daily.time.length > 0 ? series.daily.time : series.hourly.time;

  return distinctDates(axis).length;
}

function distinctDates(axis: readonly string[]): string[] {
  const seen: string[] = [];

  for (const stamp of axis) {
    const date = stamp.slice(0, DATE_LENGTH);

    if (seen.at(-1) !== date && !seen.includes(date)) {
      seen.push(date);
    }
  }

  return seen;
}

function keepDates(target: SeriesChannel, kept: ReadonlySet<string>): SeriesChannel {
  const indices = target.time.flatMap((stamp, index) =>
    kept.has(stamp.slice(0, DATE_LENGTH)) ? [index] : [],
  );

  if (indices.length === target.time.length) {
    return target;
  }

  const values: Partial<Record<MetricCode, MetricValues>> = {};

  for (const [code, series] of Object.entries(target.values) as [MetricCode, MetricValues][]) {
    values[code] = indices.map((index) => series[index] ?? null);
  }

  return { time: indices.map((index) => target.time[index] ?? ''), values };
}
