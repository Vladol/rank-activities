import type { Result } from '../../../domain/shared/result';
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
