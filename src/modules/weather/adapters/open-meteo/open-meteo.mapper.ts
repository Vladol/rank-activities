import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { Capability, MetricCode } from '../../../../domain/weather/metric';
import { metric } from '../../../../domain/weather/metric';
import type { SourceUnit } from '../../../../domain/weather/units';
import { convertToCanonical } from '../../../../domain/weather/units';
import {
  type MetricValues,
  type SeriesChannel,
  type WeatherSeries,
  channel,
  createSeries,
} from '../../../../domain/weather/weather-series';
import type { WeatherError } from '../../ports/contracts';
import { ABSENT_VARIABLE_UNIT, type OpenMeteoResponse } from './open-meteo.schema';

/**
 * Turns a validated Open-Meteo envelope into the domain series, in canonical
 * units. Shared by the recorded sources and the live client: a fixture that
 * skipped this step would prove nothing about the API (design.md, Decision 1).
 *
 * Only the metric dictionary crosses the boundary. Everything Open-Meteo
 * returns that no metric names — humidity, pressure, swell components, the
 * uv index — is dropped here rather than travelling as an untyped extra.
 */

/** Open-Meteo's hourly variable names, for the metrics the dictionary knows. */
const HOURLY_METRIC_BY_VARIABLE: Readonly<Record<string, MetricCode>> = {
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
  wave_height: 'wave_height',
  wave_period: 'wave_period',
  wave_direction: 'wave_direction',
  sea_surface_temperature: 'sea_surface_temperature',
};

/**
 * The daily channel names an aggregate where the hourly one names the
 * quantity. `snowfall_sum` and `snowfall` are the same metric on two axes, so
 * they map onto one code and the axis says which is which.
 *
 * `sunrise` and `sunset` are deliberately absent: a series slot is a number or
 * a hole, and those two are ISO strings. They stay in the dictionary because a
 * request may still ask for them; the series cannot carry them.
 */
const DAILY_METRIC_BY_VARIABLE: Readonly<Record<string, MetricCode>> = {
  weather_code: 'weather_code',
  temperature_2m_max: 'temperature_2m_max',
  temperature_2m_min: 'temperature_2m_min',
  daylight_duration: 'daylight_duration',
  sunshine_duration: 'sunshine_duration',
  precipitation_sum: 'precipitation',
  precipitation_hours: 'precipitation_hours',
  snowfall_sum: 'snowfall',
  wind_speed_10m_max: 'wind_speed_10m',
  wind_gusts_10m_max: 'wind_gusts_10m',
  wind_direction_10m_dominant: 'wind_direction_10m',
  wave_height_max: 'wave_height',
  wave_period_max: 'wave_period',
  wave_direction_dominant: 'wave_direction',
};

/**
 * The unit strings Open-Meteo writes, against the vocabulary the converters
 * speak. Keeping the two apart is what lets `°F` be rejected by name instead
 * of silently read as Celsius (stage-three.md, section 2.4).
 */
const SOURCE_UNIT_BY_LABEL: Readonly<Record<string, SourceUnit>> = {
  '°C': 'degC',
  '°F': 'degF',
  '°': 'degree',
  '%': 'percent',
  s: 'second',
  h: 'hour',
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  km: 'km',
  'km/h': 'km/h',
  'm/s': 'm/s',
  mph: 'mph',
  kn: 'kn',
  inch: 'inch',
  'wmo code': 'wmo_code',
  iso8601: 'iso8601',
  // `is_day` and the uv index arrive with no unit at all.
  '': 'boolean',
};

export interface MappingContext {
  readonly sourceId: string;
  readonly capability: Capability;
  /** When the data was obtained, as an ISO instant. */
  readonly fetchedAt: string;
  /** Whether it came from a cache past its refresh window. */
  readonly stale?: boolean;
}

export function mapOpenMeteoResponse(
  response: OpenMeteoResponse,
  context: MappingContext,
): Result<WeatherSeries, WeatherError> {
  const hourly = mapChannel(
    response.hourly,
    response.hourly_units,
    HOURLY_METRIC_BY_VARIABLE,
    (time) => offsetIso(time, response.utc_offset_seconds),
  );

  if (!hourly.ok) {
    return hourly;
  }

  // The daily axis is a list of local dates, not of instants: attaching an
  // offset to `2026-09-07` would claim a precision the source never had.
  const daily = mapChannel(
    response.daily,
    response.daily_units,
    DAILY_METRIC_BY_VARIABLE,
    (time) => time,
  );

  if (!daily.ok) {
    return daily;
  }

  const metrics = [
    ...new Set([...metricsOf(hourly.value), ...metricsOf(daily.value)]),
  ];

  return ok(
    createSeries({
      hourly: hourly.value,
      daily: daily.value,
      provenance: [
        {
          sourceId: context.sourceId,
          capability: context.capability,
          gridPoint: {
            latitude: response.latitude,
            longitude: response.longitude,
            elevationMetres: response.elevation,
          },
          fetchedAt: context.fetchedAt,
          stale: context.stale ?? false,
          metrics,
          timezone: response.timezone,
        },
      ],
    }),
  );
}

/**
 * A naive local timestamp with the offset the envelope reported attached.
 * Open-Meteo writes `2026-09-07T14:00` and puts the offset in
 * `utc_offset_seconds`; parsing the string on its own reads it as UTC and
 * moves the instant by up to half a day (stage-three.md, section 2.2).
 */
export function offsetIso(naive: string, utcOffsetSeconds: number): string {
  const sign = utcOffsetSeconds < 0 ? '-' : '+';
  const total = Math.abs(utcOffsetSeconds);
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = naive.length === 16 ? ':00' : '';

  return `${naive}${seconds}${sign}${hours}:${minutes}`;
}

type Block = NonNullable<OpenMeteoResponse['hourly']>;
type Units = NonNullable<OpenMeteoResponse['hourly_units']>;

function mapChannel(
  block: Block | undefined,
  units: Units | undefined,
  metricByVariable: Readonly<Record<string, MetricCode>>,
  mapTime: (time: string) => string,
): Result<SeriesChannel, WeatherError> {
  if (block === undefined || units === undefined) {
    return ok(channel([], {}));
  }

  const values: Partial<Record<MetricCode, MetricValues>> = {};

  for (const [variable, code] of Object.entries(metricByVariable)) {
    const series = block[variable];
    const label = units[variable];

    if (series === undefined || label === undefined) {
      continue;
    }

    const converted = convertSeries(variable, code, label, series);

    if (!converted.ok) {
      return converted;
    }

    values[code] = converted.value;
  }

  return ok(channel(block.time.map(mapTime), values));
}

function convertSeries(
  variable: string,
  code: MetricCode,
  label: string,
  series: readonly (number | string | null)[],
): Result<MetricValues, WeatherError> {
  // A variable the model does not carry: the unit reads "undefined" and the
  // schema has already checked that every slot is empty.
  if (label === ABSENT_VARIABLE_UNIT) {
    return ok(series.map(() => null));
  }

  const from = SOURCE_UNIT_BY_LABEL[label];

  if (from === undefined) {
    return err(
      domainError('SCHEMA_MISMATCH', 'the source sent a unit this adapter does not know', {
        metric: code,
        variable,
        received: label,
      }),
    );
  }

  const to = metric(code).canonicalUnit;
  const converted: (number | null)[] = [];

  for (const slot of series) {
    if (typeof slot === 'string') {
      return err(
        domainError('SCHEMA_MISMATCH', 'a numeric series carried text', {
          metric: code,
          variable,
        }),
      );
    }

    const value = convertToCanonical(from, to, slot);

    if (!value.ok) {
      return err({ ...value.error, context: { ...value.error.context, metric: code, variable } });
    }

    converted.push(value.value);
  }

  return ok(converted);
}

function metricsOf(target: SeriesChannel): readonly MetricCode[] {
  return Object.keys(target.values) as MetricCode[];
}

/** Every metric this mapper can produce, on either axis. Used to answer `supports`. */
export const MAPPABLE_METRICS: readonly MetricCode[] = [
  ...new Set([
    ...Object.values(HOURLY_METRIC_BY_VARIABLE),
    ...Object.values(DAILY_METRIC_BY_VARIABLE),
  ]),
];
