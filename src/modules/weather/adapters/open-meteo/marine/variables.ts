import { domainError } from '../../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../../domain/shared/result';
import { METRICS, type MetricCode, metric } from '../../../../../domain/weather/metric';
import type { WeatherError } from '../../../ports/contracts';
import type { VendorVariables } from '../asked-variables';

/**
 * The metric dictionary in the marine host's spelling.
 *
 * The wave components the host also serves — wind wave, swell wave, their
 * periods and directions — are deliberately absent: no metric names them, so
 * asking for them would be paying for data nothing can read
 * (open-meteo.mapper.ts, on what crosses the boundary).
 */
const HOURLY_VARIABLE: Readonly<Partial<Record<MetricCode, string>>> = {
  wave_height: 'wave_height',
  wave_period: 'wave_period',
  wave_direction: 'wave_direction',
  sea_surface_temperature: 'sea_surface_temperature',
};

const DAILY_VARIABLE: Readonly<Partial<Record<MetricCode, string>>> = {
  wave_height: 'wave_height_max',
  wave_period: 'wave_period_max',
  wave_direction: 'wave_direction_dominant',
};

const DICTIONARY_ORDER = Object.keys(METRICS) as readonly MetricCode[];

export function marineVariables(
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
          `the marine source has no variable for the metric "${code}"`,
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

export const MARINE_METRICS: readonly MetricCode[] = DICTIONARY_ORDER.filter(
  (code) => HOURLY_VARIABLE[code] !== undefined || DAILY_VARIABLE[code] !== undefined,
);
