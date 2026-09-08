import { Inject, Injectable } from '@nestjs/common';

import type {
  LocationError,
  PlaceContext,
  ResolvedLocation,
} from '../../domain/location/resolved-location';
import type { Coordinates } from '../../domain/shared/coordinates';
import { isOnEarth, locationId } from '../../domain/shared/coordinates';
import { domainError } from '../../domain/shared/domain-error';
import { type Result, err, ok } from '../../domain/shared/result';
import type { PlaceCandidate, PlaceLookupPort } from '../weather/ports/place-lookup.port';
import { PLACE_LOOKUP_PORT } from '../weather/ports/tokens';

export type LocationQuery =
  | { readonly kind: 'name'; readonly name: string; readonly language?: string }
  | { readonly kind: 'coordinates'; readonly coordinates: Coordinates };

/**
 * Turns what the client asked about into a place we can profile.
 *
 * Three decisions live here rather than at the port: which of several
 * candidates is meant, that no candidate at all is `LOCATION_NOT_FOUND`, and
 * that a lookup that failed is not a location that does not exist. The port
 * reports what the source said and stops (`place-lookup.port.ts`).
 */
@Injectable()
export class LocationResolverService {
  constructor(@Inject(PLACE_LOOKUP_PORT) private readonly lookup: PlaceLookupPort) {}

  async resolve(query: LocationQuery): Promise<Result<ResolvedLocation, LocationError>> {
    return query.kind === 'coordinates'
      ? Promise.resolve(this.fromCoordinates(query.coordinates))
      : this.fromName(query);
  }

  private fromCoordinates(coordinates: Coordinates): Result<ResolvedLocation, LocationError> {
    if (!isOnEarth(coordinates)) {
      return err(invalidCoordinates(coordinates));
    }

    return ok({
      id: locationId(coordinates),
      coordinates,
      timezone: 'auto',
      elevationMetres: null,
      place: null,
    });
  }

  private async fromName(query: {
    readonly name: string;
    readonly language?: string;
  }): Promise<Result<ResolvedLocation, LocationError>> {
    const found = await this.lookup.lookup({
      name: query.name,
      ...(query.language === undefined ? {} : { language: query.language }),
    });

    if (!found.ok) {
      // The source failed; the place may well exist. Saying "not found" here
      // would turn an outage into a fact about the world.
      return err(
        domainError('PROVIDER_UNAVAILABLE', 'the place lookup could not be reached', {
          cause: found.error.code,
        }),
      );
    }

    const chosen = mostPopulous(found.value);

    if (chosen === undefined) {
      return err(
        domainError('LOCATION_NOT_FOUND', 'no place matches that name', { name: query.name }),
      );
    }

    const coordinates = { latitude: chosen.latitude, longitude: chosen.longitude };

    if (!isOnEarth(coordinates)) {
      return err(invalidCoordinates(coordinates));
    }

    return ok({
      id: locationId(coordinates),
      coordinates,
      timezone: chosen.timezone,
      elevationMetres: chosen.elevationMetres,
      place: contextOf(chosen),
    });
  }
}

/**
 * The most populous candidate, with a candidate that declares no population
 * ranked as zero rather than dropped: it is still the answer when it is the
 * only one. Ties keep the source's order, so the choice is reproducible.
 */
function mostPopulous(candidates: readonly PlaceCandidate[]): PlaceCandidate | undefined {
  return candidates.reduce<PlaceCandidate | undefined>(
    (best, candidate) =>
      best === undefined || (candidate.population ?? 0) > (best.population ?? 0) ? candidate : best,
    undefined,
  );
}

function contextOf(candidate: PlaceCandidate): PlaceContext {
  return {
    name: candidate.name,
    sourcePlaceId: candidate.sourcePlaceId,
    ...(candidate.countryCode === undefined ? {} : { countryCode: candidate.countryCode }),
    ...(candidate.admin1 === undefined ? {} : { admin1: candidate.admin1 }),
    ...(candidate.population === undefined ? {} : { population: candidate.population }),
  };
}

function invalidCoordinates(coordinates: Coordinates): LocationError {
  return domainError('INVALID_COORDINATES', 'those coordinates name no point on Earth', {
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
  });
}
