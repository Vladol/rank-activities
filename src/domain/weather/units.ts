import { type DomainError, domainError } from '../shared/domain-error';
import { type Result, err, ok } from '../shared/result';

/**
 * The canonical unit vocabulary. One unit per metric, fixed here, so that a
 * value's unit is a property of its type rather than of the source that sent it
 * (design.md, Decision 3 of `01-add-weather-source-contract`).
 *
 * The converters that map a source's units onto these live below and are called
 * only from a vendor mapper.
 */
export const CANONICAL_UNITS = [
  'degC',
  'mm',
  'cm',
  'm',
  'km',
  'm/s',
  'degree',
  'percent',
  'second',
  'hour',
  'wmo_code',
  'boolean',
  'iso8601',
  // Not a unit any metric is carried in: what `shareOfHours` produces when it
  // collapses a day into a fraction (stage-five.md, section 3).
  'ratio',
] as const;

export type CanonicalUnit = (typeof CANONICAL_UNITS)[number];

/**
 * Units a source may send. Beyond the canonical set these are the ones
 * Open-Meteo switches to when `temperature_unit`, `wind_speed_unit` or
 * `precipitation_unit` are passed. The adapter never passes them
 * (docs/development-flow/stage-three.md, section 2.4), so receiving one is a
 * schema mismatch rather than a conversion.
 */
export type SourceUnit = CanonicalUnit | 'km/h' | 'degF' | 'mph' | 'kn' | 'inch';

const SECONDS_PER_HOUR = 3600;
const METRES_PER_KILOMETRE = 1000;

export function kmhToMs(value: number): number {
  return (value * METRES_PER_KILOMETRE) / SECONDS_PER_HOUR;
}

export function metresToKm(value: number): number {
  return value / METRES_PER_KILOMETRE;
}

/** The only unit pairs the service converts. Everything else must already match. */
const CONVERTERS: ReadonlyMap<string, (value: number) => number> = new Map([
  ['km/h->m/s', kmhToMs],
  ['m->km', metresToKm],
]);

/**
 * Brings one value into its metric's canonical unit. Called from a vendor
 * mapper and nowhere else: past the mapper the unit is part of the type
 * (design.md, Decision 3).
 *
 * A `null` stays `null` — absence is data, not a value to be filled in.
 */
export function convertToCanonical(
  from: SourceUnit,
  to: CanonicalUnit,
  value: number | null,
): Result<number | null, DomainError<'SCHEMA_MISMATCH'>> {
  if (value === null) {
    return ok(null);
  }

  if (from === to) {
    return ok(value);
  }

  const converter = CONVERTERS.get(`${from}->${to}`);

  if (converter === undefined) {
    return err(
      domainError('SCHEMA_MISMATCH', `expected a value in ${to} but the source sent ${from}`, {
        expected: to,
        received: from,
      }),
    );
  }

  return ok(converter(value));
}
