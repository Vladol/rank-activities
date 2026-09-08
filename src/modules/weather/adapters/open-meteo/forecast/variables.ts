import { domainError } from '../../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../../domain/shared/result';
import { METRICS, type MetricCode, metric } from '../../../../../domain/weather/metric';
import type { WeatherError } from '../../../ports/contracts';
import type { VendorVariables } from '../asked-variables';

export type { VendorVariables };

/**
 * The metric dictionary in the vendor's spelling, for the forecast host.
 *
 * This is one of the two files that are allowed to know what Open-Meteo calls
 * things — the map here and the mapper that reads the answer back. Everything
 * else in the service speaks metric codes (spec `open-meteo-source`, "The
 * vendor's vocabulary does not leave its package").
 *
 * Note what is absent: no `temperature_unit`, no `wind_speed_unit`, no
 * `precipitation_unit`. A unit is asserted from what the answer declares, never
 * requested (design.md, Decision 3).
 */
const HOURLY_VARIABLE: Readonly<Partial<Record<MetricCode, string>>> = {
  temperature_2m: 'temperature_2m',
  apparent_temperature: 'apparent_temperature',
  precipitation: 'precipitation',
  precipitation_probability: 'precipitation_probability',
  snowfall: 'snowfall',
  snow_depth: 'snow_depth',
  weather_code: 'weather_code',
  cloud_cover: 'cloud_cover',
  visibility: 'visibility',
  wind_speed_10m: 'wind_speed_10m',
  wind_gusts_10m: 'wind_gusts_10m',
  wind_direction_10m: 'wind_direction_10m',
  is_day: 'is_day',
  sunshine_duration: 'sunshine_duration',
  freezing_level_height: 'freezing_level_height',
};

/**
 * The daily channel names an aggregate where the hourly one names the
 * quantity: `wind_speed_10m` becomes `wind_speed_10m_max`, `snowfall` becomes
 * `snowfall_sum`. One metric, two spellings, and the axis says which is meant.
 */
const DAILY_VARIABLE: Readonly<Partial<Record<MetricCode, string>>> = {
  weather_code: 'weather_code',
  temperature_2m_max: 'temperature_2m_max',
  temperature_2m_min: 'temperature_2m_min',
  daylight_duration: 'daylight_duration',
  sunshine_duration: 'sunshine_duration',
  precipitation: 'precipitation_sum',
  precipitation_hours: 'precipitation_hours',
  snowfall: 'snowfall_sum',
  wind_speed_10m: 'wind_speed_10m_max',
  wind_gusts_10m: 'wind_gusts_10m_max',
  wind_direction_10m: 'wind_direction_10m_dominant',
};

const DICTIONARY_ORDER = Object.keys(METRICS) as readonly MetricCode[];

/**
 * What to put in `hourly=` and `daily=` for the metrics asked for.
 *
 * The order is the dictionary's rather than the caller's, so the same set of
 * metrics always produces the same URL — which is what makes that URL usable
 * as a cache key in `07`.
 */
export function forecastVariables(
  metrics: readonly MetricCode[],
): Result<VendorVariables, WeatherError> {
  const wanted = new Set(metrics);
  const hourly: string[] = [];
  const daily: string[] = [];

  for (const code of DICTIONARY_ORDER) {
    if (!wanted.has(code)) {
      continue;
    }

    const onHourly = HOURLY_VARIABLE[code];
    const onDaily = DAILY_VARIABLE[code];

    if (onHourly === undefined && onDaily === undefined) {
      return err(
        domainError(
          'UNSUPPORTED_METRIC',
          `the forecast source has no variable for the metric "${code}"`,
          { metric: code, capability: metric(code).capability },
        ),
      );
    }

    if (onHourly !== undefined) {
      hourly.push(onHourly);
    }

    if (onDaily !== undefined) {
      daily.push(onDaily);
    }
  }

  return ok({ hourly, daily });
}
