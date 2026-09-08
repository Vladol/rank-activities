import { z } from 'zod';

import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { WeatherError } from '../../ports/contracts';

/**
 * The Open-Meteo response envelope, validated before anything is read out of
 * it. It is shared by the recorded sources and, later, by the live client:
 * a fixture that never went through this schema would prove nothing about the
 * API (design.md, Decision 1).
 *
 * The unit table is the point of the exercise. `temperature_unit`,
 * `wind_speed_unit` and `precipitation_unit` change the values and the
 * `*_units` block but not the field names, so a response in Fahrenheit is
 * indistinguishable from one in Celsius unless the units are checked
 * (stage-three.md, section 2.4). We never send those parameters; receiving a
 * unit we did not ask for is therefore a schema mismatch, not a conversion.
 */
export const EXPECTED_SOURCE_UNITS: Readonly<Record<string, string>> = {
  time: 'iso8601',

  // Forecast and archive, hourly.
  temperature_2m: '°C',
  apparent_temperature: '°C',
  dew_point_2m: '°C',
  relative_humidity_2m: '%',
  precipitation: 'mm',
  rain: 'mm',
  showers: 'mm',
  snowfall: 'cm',
  // Beside snowfall in centimetres: the 100x trap.
  snow_depth: 'm',
  weather_code: 'wmo code',
  pressure_msl: 'hPa',
  cloud_cover: '%',
  precipitation_probability: '%',
  visibility: 'm',
  wind_speed_10m: 'km/h',
  wind_gusts_10m: 'km/h',
  wind_direction_10m: '°',
  uv_index: '',
  is_day: '',
  sunshine_duration: 's',
  freezing_level_height: 'm',

  // Forecast and archive, daily.
  temperature_2m_max: '°C',
  temperature_2m_min: '°C',
  apparent_temperature_max: '°C',
  apparent_temperature_min: '°C',
  sunrise: 'iso8601',
  sunset: 'iso8601',
  daylight_duration: 's',
  uv_index_max: '',
  precipitation_sum: 'mm',
  rain_sum: 'mm',
  showers_sum: 'mm',
  snowfall_sum: 'cm',
  precipitation_hours: 'h',
  precipitation_probability_max: '%',
  wind_speed_10m_max: 'km/h',
  wind_gusts_10m_max: 'km/h',
  wind_direction_10m_dominant: '°',

  // Marine.
  wave_height: 'm',
  wave_period: 's',
  wave_direction: '°',
  wind_wave_height: 'm',
  wind_wave_period: 's',
  swell_wave_height: 'm',
  swell_wave_period: 's',
  swell_wave_direction: '°',
  sea_surface_temperature: '°C',
  wave_height_max: 'm',
  wave_period_max: 's',
  wave_direction_dominant: '°',
  swell_wave_height_max: 'm',
};

/**
 * The unit the archive reports for a variable the model does not carry at all.
 * ERA5 answers `"undefined"` for `visibility` and `freezing_level_height`, with
 * `null` in every slot (stage-three.md, section 6). It is accepted only when
 * the series really is empty — otherwise it would wave through a variable
 * whose unit we could not name.
 */
export const ABSENT_VARIABLE_UNIT = 'undefined';

/** One slot of a series: a measurement, a timestamp, or a hole the source left. */
const slotSchema = z.union([z.number(), z.string(), z.null()]);

const blockSchema = z
  .object({ time: z.array(z.string()) })
  .catchall(z.array(slotSchema));

const unitsSchema = z.record(z.string(), z.string());

const envelopeSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  generationtime_ms: z.number(),
  /** The offset the naive timestamps are to be read against; never assume UTC. */
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  elevation: z.number(),
  hourly_units: unitsSchema.optional(),
  hourly: blockSchema.optional(),
  daily_units: unitsSchema.optional(),
  daily: blockSchema.optional(),
});

export type OpenMeteoResponse = z.infer<typeof envelopeSchema>;

type Block = z.infer<typeof blockSchema>;
type Units = z.infer<typeof unitsSchema>;

export const openMeteoResponseSchema = envelopeSchema.superRefine((value, context) => {
  checkChannel(value.hourly, value.hourly_units, 'hourly', context);
  checkChannel(value.daily, value.daily_units, 'daily', context);
});

function checkChannel(
  block: Block | undefined,
  units: Units | undefined,
  axis: 'hourly' | 'daily',
  context: z.RefinementCtx,
): void {
  if (units === undefined || block === undefined) {
    // A response that declares neither is a response that was not asked for
    // this channel: `marine-prague-inland` has no daily block at all.
    if ((units === undefined) !== (block === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [axis],
        message: `${axis} and ${axis}_units must either both be present or both be absent`,
      });
    }

    return;
  }

  for (const [variable, unit] of Object.entries(units)) {
    const path = [`${axis}_units`, variable];

    if (variable === 'time') {
      continue;
    }

    const series = block[variable];

    // A declared variable with no array is the one shape a series must never
    // have: the caller would read `undefined` where the source promised data.
    if (series === undefined) {
      context.addIssue({
        code: 'custom',
        path: [axis, variable],
        message: `${variable} is declared in ${axis}_units but carries no array in ${axis}`,
      });
      continue;
    }

    if (series.length !== block.time.length) {
      context.addIssue({
        code: 'custom',
        path: [axis, variable],
        message: `${variable} has ${series.length} values against a time axis of ${block.time.length}`,
      });
    }

    if (unit === ABSENT_VARIABLE_UNIT) {
      if (!series.every((slot) => slot === null)) {
        context.addIssue({
          code: 'custom',
          path,
          message: `${variable} has no unit but does carry values`,
        });
      }

      continue;
    }

    const expected = EXPECTED_SOURCE_UNITS[variable];

    if (expected !== undefined && unit !== expected) {
      context.addIssue({
        code: 'custom',
        path,
        message: `${variable} arrived in "${unit}" where the request asked for "${expected}"`,
      });
    }
  }
}

/**
 * Text to a validated envelope, or a typed failure. Nothing here throws, and
 * nothing the source wrote is copied into the error: stage 3 recorded one
 * `reason` that was factually wrong and one that leaked an internal type name.
 */
export function parseOpenMeteoBody(body: string): Result<OpenMeteoResponse, WeatherError> {
  const parsed = parseJsonBody(body);

  return parsed.ok ? validateOpenMeteoEnvelope(parsed.value) : parsed;
}

/**
 * Text to JSON, with the empty 200 caught before it becomes a `SyntaxError`
 * thrown past the adapter (stage-three.md, section 6).
 */
export function parseJsonBody(body: string): Result<unknown, WeatherError> {
  try {
    return ok(JSON.parse(body));
  } catch {
    return err(
      domainError('MALFORMED_BODY', 'the source answered with a body that is not JSON', {
        bytes: body.length,
      }),
    );
  }
}

/** A parsed body against the envelope, for callers that had to read it first. */
export function validateOpenMeteoEnvelope(
  parsed: unknown,
): Result<OpenMeteoResponse, WeatherError> {
  const result = openMeteoResponseSchema.safeParse(parsed);

  if (!result.success) {
    return err(
      domainError('SCHEMA_MISMATCH', 'the response does not match the Open-Meteo envelope', {
        issues: result.error.issues.length,
        firstPath: result.error.issues[0]?.path.join('.') ?? '(root)',
      }),
    );
  }

  return ok(result.data);
}
