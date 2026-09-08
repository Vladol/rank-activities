import { Field, Float, InputType, Int } from '@nestjs/graphql';

import { isOnEarth } from '../../../domain/shared/coordinates';
import { type DomainError, domainError } from '../../../domain/shared/domain-error';
import type { ReasonCode } from '../../../domain/shared/reason-code';
import type { LocationQuery } from '../../geo/location-resolver.service';

/**
 * What the client asks about. A name or a point, never both and never neither
 * — checked here rather than by the resolver, because a request that names
 * neither is not a ranking that failed, it is a request that was never made.
 *
 * Both faults answer with a code from the reason registry, so the vocabulary a
 * client learns for a refused activity is the same one it learns for a refused
 * request (spec, "Every code the API emits comes from the registry").
 */
@InputType('LocationInput')
export class LocationInputModel {
  @Field(() => String, { nullable: true, description: 'A city name, in any spelling the geocoder knows.' })
  name?: string;

  @Field(() => Float, { nullable: true })
  latitude?: number;

  @Field(() => Float, { nullable: true })
  longitude?: number;

  @Field(() => String, { nullable: true, description: 'The language the name is written in.' })
  language?: string;
}

/**
 * One location and one horizon.
 *
 * Deliberately a single object rather than a list: making it a list later would
 * be a new field beside this one, and every client that ignores the new field
 * keeps working (spec, "The query takes exactly one location").
 */
@InputType('RankingInput')
export class RankingInputModel {
  @Field(() => LocationInputModel)
  location!: LocationInputModel;

  @Field(() => Int, {
    nullable: true,
    // The configured range is written into this description when the schema is
    // built (`horizon-in-schema.ts`), so the bound is part of the published
    // contract and not only of a validator.
    description: 'Days ahead, including today. Omitted uses the configured default.',
  })
  days?: number;
}

export type LocationInputFault = DomainError<ReasonCode>;

const NEITHER = 'a location is a name or a pair of coordinates, and this request gave neither';
const BOTH = 'a location is a name or a pair of coordinates, not both';
const PARTIAL = 'a point needs both a latitude and a longitude';
const OFF_EARTH = 'those coordinates name no point on Earth';

/**
 * The query as the domain states it, or why the input was not one. A resolver
 * that guessed — taking the name when both were given — would answer a question
 * nobody asked.
 *
 * A malformed point is `INVALID_COORDINATES` and an unmatched name is
 * `LOCATION_NOT_FOUND`, decided later by the resolver: the first is a request
 * we could not read, the second is an answer about the world.
 */
export function toLocationQuery(
  input: LocationInputModel,
): { readonly query: LocationQuery } | { readonly fault: LocationInputFault } {
  const named = input.name !== undefined && input.name.trim() !== '';
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;

  if (named && (hasLatitude || hasLongitude)) {
    return { fault: domainError('INVALID_LOCATION_INPUT', BOTH) };
  }

  if (named) {
    return {
      query: {
        kind: 'name',
        name: input.name ?? '',
        ...(input.language === undefined ? {} : { language: input.language }),
      },
    };
  }

  if (hasLatitude !== hasLongitude) {
    return { fault: domainError('INVALID_COORDINATES', PARTIAL) };
  }

  if (!hasLatitude) {
    return { fault: domainError('INVALID_LOCATION_INPUT', NEITHER) };
  }

  const coordinates = { latitude: input.latitude ?? 0, longitude: input.longitude ?? 0 };

  // Refused here rather than by the geocoder: a latitude of 999 is our caller's
  // mistake, and asking a source about it would spend a call to be told so.
  if (!isOnEarth(coordinates)) {
    return { fault: domainError('INVALID_COORDINATES', OFF_EARTH) };
  }

  return { query: { kind: 'coordinates', coordinates } };
}
