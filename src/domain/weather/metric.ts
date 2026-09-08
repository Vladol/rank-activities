import type { CanonicalUnit } from './units';

/**
 * Which source capability serves a metric. Forecast, marine and archive are
 * separate hosts with their own refresh cadence and their own failure
 * semantics, so they are separate seams
 * (design.md, Decision 1 of `01-add-weather-source-contract`).
 */
export const CAPABILITIES = ['forecast', 'marine', 'archive'] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Which channel of a response carries the metric. */
export const GRANULARITIES = ['hourly', 'daily', 'both'] as const;

export type Granularity = (typeof GRANULARITIES)[number];

/** What kind of quantity the metric is, which decides how it may be compared. */
export const METRIC_KINDS = ['continuous', 'categorical', 'flag'] as const;

export type MetricKind = (typeof METRIC_KINDS)[number];

export interface MetricDefinition<Code extends string = string> {
  readonly code: Code;
  readonly canonicalUnit: CanonicalUnit;
  readonly granularity: Granularity;
  readonly capability: Capability;
  readonly kind: MetricKind;
  /**
   * The **physical** bounds of the metric in its canonical unit, not the range
   * the seven recorded locations happen to cover: 1.6 m is the deepest snow on
   * record here and that does not make 4 m an error
   * (docs/development-flow/stage-five.md, section 8).
   *
   * It is half of the defence against a threshold written in the wrong unit.
   * The range alone cannot reject a gust threshold of 60 — 60 m/s is a possible
   * hurricane — and the declared unit alone cannot see a typo in the number.
   * Together the unit makes the author's intent explicit and the range rejects
   * a value that is only meaningful in another unit.
   *
   * Absent for the metrics that carry no number: `sunrise` and `sunset`.
   */
  readonly plausible?: readonly [min: number, max: number];
}

/**
 * The metric dictionary: docs/development-flow/stage-three.md, section 4, in
 * code. Every metric the service can ask any source for is one entry here, and
 * adding a metric is this file plus a mapper line.
 *
 * The capability column is what keeps vendor topology out of the activity
 * declarations: nothing states that surfing needs marine data, the planner
 * derives it from the metrics surfing declares (design.md, Decision 2).
 */
export const METRICS = defineMetricDictionary({
  snow_depth: def('snow_depth', 'm', 'hourly', 'forecast', 'continuous', [0, 30]),
  // Beside snow_depth in metres. The 100x trap of stage-three.md, section 2.4.
  snowfall: def('snowfall', 'cm', 'both', 'forecast', 'continuous', [0, 300]),
  freezing_level_height: def('freezing_level_height', 'm', 'hourly', 'forecast', 'continuous', [0, 6000]),
  temperature_2m: def('temperature_2m', 'degC', 'hourly', 'forecast', 'continuous', [-90, 60]),
  apparent_temperature: def('apparent_temperature', 'degC', 'hourly', 'forecast', 'continuous', [-90, 60]),
  precipitation: def('precipitation', 'mm', 'both', 'forecast', 'continuous', [0, 400]),
  precipitation_hours: def('precipitation_hours', 'hour', 'daily', 'forecast', 'continuous', [0, 24]),
  precipitation_probability: def('precipitation_probability', 'percent', 'hourly', 'forecast', 'continuous', [0, 100]),
  // Sent as km/h, crosses the port as m/s.
  wind_speed_10m: def('wind_speed_10m', 'm/s', 'both', 'forecast', 'continuous', [0, 40]),
  wind_gusts_10m: def('wind_gusts_10m', 'm/s', 'both', 'forecast', 'continuous', [0, 45]),
  wind_direction_10m: def('wind_direction_10m', 'degree', 'both', 'forecast', 'continuous', [0, 360]),
  cloud_cover: def('cloud_cover', 'percent', 'hourly', 'forecast', 'continuous', [0, 100]),
  sunshine_duration: def('sunshine_duration', 'second', 'both', 'forecast', 'continuous', [0, 86400]),
  // Sent in metres, crosses the port as km.
  visibility: def('visibility', 'km', 'hourly', 'forecast', 'continuous', [0, 100]),
  weather_code: def('weather_code', 'wmo_code', 'both', 'forecast', 'categorical', [0, 99]),
  is_day: def('is_day', 'boolean', 'hourly', 'forecast', 'flag', [0, 1]),
  daylight_duration: def('daylight_duration', 'second', 'daily', 'forecast', 'continuous', [0, 86400]),
  sunrise: def('sunrise', 'iso8601', 'daily', 'forecast', 'continuous'),
  sunset: def('sunset', 'iso8601', 'daily', 'forecast', 'continuous'),
  temperature_2m_max: def('temperature_2m_max', 'degC', 'daily', 'forecast', 'continuous', [-90, 60]),
  temperature_2m_min: def('temperature_2m_min', 'degC', 'daily', 'forecast', 'continuous', [-90, 60]),
  wave_height: def('wave_height', 'm', 'both', 'marine', 'continuous', [0, 30]),
  wave_period: def('wave_period', 'second', 'both', 'marine', 'continuous', [0, 30]),
  wave_direction: def('wave_direction', 'degree', 'both', 'marine', 'continuous', [0, 360]),
  sea_surface_temperature: def('sea_surface_temperature', 'degC', 'hourly', 'marine', 'continuous', [-5, 40]),
});

export type MetricCode = keyof typeof METRICS;

export type MetricDictionary = Readonly<Record<MetricCode, MetricDefinition<MetricCode>>>;

export function metric(code: MetricCode): MetricDefinition<MetricCode> {
  return METRICS[code];
}

export function isMetricCode(value: string): value is MetricCode {
  return Object.hasOwn(METRICS, value);
}

/** Every metric of a capability, in dictionary order. */
export function metricsOfCapability(capability: Capability): readonly MetricCode[] {
  return (Object.keys(METRICS) as MetricCode[]).filter(
    (code) => METRICS[code].capability === capability,
  );
}

/**
 * Builds a dictionary and refuses an incomplete entry as it does so. The check
 * runs while this module is being imported, so a metric added without a
 * canonical unit, a granularity or a serving capability kills the process at
 * startup rather than at the first request
 * (spec `weather-sources`, "Every metric declares its canonical unit").
 */
export function defineMetricDictionary<
  Entries extends Readonly<Record<string, MetricDefinition<string>>>,
>(entries: Entries): Entries {
  validateMetricDictionary(entries);

  return entries;
}

export function validateMetricDictionary(
  dictionary: Readonly<Record<string, MetricDefinition<string>>>,
): void {
  for (const [code, entry] of Object.entries(dictionary)) {
    for (const field of ['canonicalUnit', 'granularity', 'capability', 'kind'] as const) {
      if (entry[field] === undefined) {
        throw new Error(`Metric "${code}" has no ${field} in the metric dictionary.`);
      }
    }
  }
}

function def<Code extends string>(
  code: Code,
  canonicalUnit: CanonicalUnit,
  granularity: Granularity,
  capability: Capability,
  kind: MetricKind,
  plausible?: readonly [min: number, max: number],
): MetricDefinition<Code> {
  return plausible === undefined
    ? { code, canonicalUnit, granularity, capability, kind }
    : { code, canonicalUnit, granularity, capability, kind, plausible };
}
