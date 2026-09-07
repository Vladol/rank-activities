import { type DomainError, domainError } from '../shared/domain-error';
import { type Result, err, ok } from '../shared/result';
import type { MetricCode } from './metric';
import {
  type MetricValues,
  type SeriesChannel,
  type WeatherSeries,
  createSeries,
} from './weather-series';

/**
 * Faults of combining series we produced ourselves. Deliberately outside
 * `WeatherErrorCode`: that set describes what a source did to us, this one
 * describes what we did to ourselves.
 */
export type MergeErrorCode = 'METRIC_COLLISION' | 'TIME_AXIS_MISMATCH';

export type MergeError = DomainError<MergeErrorCode>;

/**
 * Combines what several capabilities returned into the one series the scoring
 * reads, keeping every provenance entry so the combined result still says
 * which source each metric came from.
 *
 * Two failures are reported rather than absorbed: the same metric arriving
 * from two sources, and two channels recorded on different time axes. Both
 * would otherwise become a silent overwrite or a silent off-by-one.
 */
export function mergeSeries(
  first: WeatherSeries,
  ...rest: readonly WeatherSeries[]
): Result<WeatherSeries, MergeError> {
  let merged = first;

  for (const next of rest) {
    const hourly = mergeChannel(merged.hourly, next.hourly, 'hourly');

    if (!hourly.ok) {
      return hourly;
    }

    const daily = mergeChannel(merged.daily, next.daily, 'daily');

    if (!daily.ok) {
      return daily;
    }

    merged = createSeries({
      hourly: hourly.value,
      daily: daily.value,
      provenance: [...merged.provenance, ...next.provenance],
    });
  }

  return ok(merged);
}

function mergeChannel(
  left: SeriesChannel,
  right: SeriesChannel,
  name: 'hourly' | 'daily',
): Result<SeriesChannel, MergeError> {
  if (right.time.length === 0) {
    return ok(left);
  }

  if (left.time.length === 0) {
    return ok(right);
  }

  if (!sameAxis(left.time, right.time)) {
    return err(
      domainError('TIME_AXIS_MISMATCH', `the ${name} channels were recorded on different axes`, {
        channel: name,
        left: left.time.length,
        right: right.time.length,
      }),
    );
  }

  const values: Partial<Record<MetricCode, MetricValues>> = { ...left.values };

  for (const [code, series] of Object.entries(right.values) as [MetricCode, MetricValues][]) {
    if (values[code] !== undefined) {
      return err(
        domainError('METRIC_COLLISION', `two sources both returned ${code} on the ${name} axis`, {
          metric: code,
          channel: name,
        }),
      );
    }

    values[code] = series;
  }

  return ok({ time: left.time, values });
}

function sameAxis(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((slot, index) => slot === right[index]);
}
