import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { WeatherError } from '../../ports/contracts';
import {
  ABSENT_VARIABLE_UNIT,
  EXPECTED_SOURCE_UNITS,
  type OpenMeteoResponse,
  parseJsonBody,
  validateOpenMeteoEnvelope,
} from './open-meteo.schema';

/** What a request put in `hourly=` and `daily=`, in the vendor's spelling. */
export interface VendorVariables {
  readonly hourly: readonly string[];
  readonly daily: readonly string[];
}

/**
 * A body checked against what this particular request asked for.
 *
 * The envelope schema owns the response's shape and the unit table, and it is
 * the same for all four hosts (design.md, Decision 1). What it cannot know is
 * which variables *this* call asked for, and two things are only decidable
 * here:
 *
 *  - the unit mismatch, reported by name. `temperature_unit=fahrenheit` returns
 *    `72.0` under the unchanged key `temperature_2m` and only `*_units` tells
 *    the truth (stage-three.md, section 2.4). The envelope rejects it too, but
 *    reports an issue count; an operator needs the variable and both units.
 *
 * Presence is deliberately *not* decided here. A variable is one spelling of a
 * metric on one axis, and a host may legitimately serve a metric on the hourly
 * axis alone; whether the caller got the metric it asked for is a question
 * about metrics, and the source answers it once, over both axes.
 */
export function parseAskedResponse(
  body: string,
  asked: VendorVariables,
): Result<OpenMeteoResponse, WeatherError> {
  const parsed = parseJsonBody(body);

  if (!parsed.ok) {
    return parsed;
  }

  const declared = checkDeclared(parsed.value, asked);

  return declared.ok ? validateOpenMeteoEnvelope(parsed.value) : declared;
}

function checkDeclared(body: unknown, asked: VendorVariables): Result<undefined, WeatherError> {
  for (const [axis, variables] of [
    ['hourly', asked.hourly],
    ['daily', asked.daily],
  ] as const) {
    const units = unitsOn(body, `${axis}_units`);

    for (const variable of variables) {
      const declared = units[variable];

      if (declared === undefined) {
        continue;
      }

      const expected = EXPECTED_SOURCE_UNITS[variable];

      // "undefined" is the archive's answer for a variable its model does not
      // carry at all; the envelope then checks that the series really is empty.
      if (declared === ABSENT_VARIABLE_UNIT || expected === undefined || declared === expected) {
        continue;
      }

      return err(
        domainError(
          'SCHEMA_MISMATCH',
          'the response declares a unit this metric is not defined in',
          { variable, axis, received: declared, expected },
        ),
      );
    }
  }

  return ok(undefined);
}

function unitsOn(body: unknown, key: string): Readonly<Record<string, string>> {
  if (typeof body !== 'object' || body === null) {
    return {};
  }

  const block = (body as Record<string, unknown>)[key];

  if (typeof block !== 'object' || block === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(block).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
