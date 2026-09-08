import { Field, Float, InputType, Int } from '@nestjs/graphql';

import type { LocationQuery } from '../../geo/location-resolver.service';

/**
 * What the client asks about. A name or a point, never both and never neither
 * — checked here rather than by the resolver, because a request that names
 * neither is not a ranking that failed, it is a request that was never made.
 *
 * The transport contract — how this refusal is carried, and under which error
 * envelope — is `09-add-graphql-api`.
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

@InputType('RankingInput')
export class RankingInputModel {
  @Field(() => LocationInputModel)
  location!: LocationInputModel;

  @Field(() => Int, { nullable: true, description: 'Days ahead, including today. Omitted uses the configured default.' })
  days?: number;
}

export type LocationInputFault = 'EMPTY' | 'BOTH' | 'PARTIAL_COORDINATES';

/**
 * The query as the domain states it, or which of the three ways the input was
 * malformed. A resolver that guessed — taking the name when both were given —
 * would answer a question nobody asked.
 */
export function toLocationQuery(
  input: LocationInputModel,
): { readonly query: LocationQuery } | { readonly fault: LocationInputFault } {
  const named = input.name !== undefined && input.name.trim() !== '';
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;

  if (named && (hasLatitude || hasLongitude)) {
    return { fault: 'BOTH' };
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
    return { fault: 'PARTIAL_COORDINATES' };
  }

  if (!hasLatitude) {
    return { fault: 'EMPTY' };
  }

  return {
    query: {
      kind: 'coordinates',
      coordinates: { latitude: input.latitude ?? 0, longitude: input.longitude ?? 0 },
    },
  };
}
