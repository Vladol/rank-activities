import { z } from 'zod';

import { domainError } from '../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../domain/shared/result';
import type { WeatherError } from './contracts';

/**
 * One place a lookup source offered. Choosing among candidates, deciding what
 * counts as not found and giving a place a stable identity are not this port's
 * concern — they belong to `location-applicability`
 * (design.md, Decision 8 of `01-add-weather-source-contract`).
 */
export interface PlaceCandidate {
  readonly sourcePlaceId: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationMetres: number;
  readonly timezone: string;
  readonly population?: number;
  readonly countryCode?: string;
  readonly admin1?: string;
}

export interface PlaceQuery {
  readonly name: string;
  readonly language?: string;
  readonly count?: number;
}

/**
 * Place lookup, under the same failure rules as the series ports: a typed
 * result rather than an exception, a validated response, and none of the
 * source's own error text passed on.
 */
export interface PlaceLookupPort {
  readonly sourceId: string;

  lookup(query: PlaceQuery): Promise<Result<readonly PlaceCandidate[], WeatherError>>;
}

const candidateSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number(),
  timezone: z.string(),
  population: z.number().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
});

/**
 * `results` is optional on purpose: a lookup that matched nothing answers 200
 * with the key absent altogether, not with an empty array
 * (docs/development-flow/stage-three.md, section 6).
 */
export const placeLookupResponseSchema = z.object({
  results: z.array(candidateSchema).optional(),
});

export function parsePlaceLookupResponse(
  body: unknown,
): Result<readonly PlaceCandidate[], WeatherError> {
  if (isErrorEnvelope(body)) {
    // The source's `reason` stays out of the error: stage 3 recorded one that
    // was factually wrong and one that leaked an internal type name.
    return err(
      domainError('SCHEMA_MISMATCH', 'the lookup source answered with an error envelope'),
    );
  }

  const parsed = placeLookupResponseSchema.safeParse(body);

  if (!parsed.success) {
    return err(
      domainError('SCHEMA_MISMATCH', 'the lookup response does not match the expected shape', {
        issues: parsed.error.issues.length,
      }),
    );
  }

  return ok((parsed.data.results ?? []).map(toCandidate));
}

function isErrorEnvelope(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'error' in body && body.error === true;
}

function toCandidate(raw: z.infer<typeof candidateSchema>): PlaceCandidate {
  return {
    sourcePlaceId: String(raw.id),
    name: raw.name,
    latitude: raw.latitude,
    longitude: raw.longitude,
    elevationMetres: raw.elevation,
    timezone: raw.timezone,
    ...(raw.population === undefined ? {} : { population: raw.population }),
    ...(raw.country_code === undefined ? {} : { countryCode: raw.country_code }),
    ...(raw.admin1 === undefined ? {} : { admin1: raw.admin1 }),
  };
}
