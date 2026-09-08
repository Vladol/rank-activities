import type { LocationId } from '../shared/branded';
import type { Coordinates } from '../shared/coordinates';
import type { DomainError } from '../shared/domain-error';

/**
 * The administrative context of a place, kept apart from the point itself
 * because a point resolved from raw coordinates has none. `null` here is the
 * honest answer to "which city is this?" for 46.20, 6.14 — inventing one would
 * be the nearest-match substitution the spec forbids.
 *
 * `sourcePlaceId` is the vendor's own identifier. It is recorded as an
 * attribute and never used as our identity (design.md, Decision 3).
 */
export interface PlaceContext {
  readonly name: string;
  readonly sourcePlaceId: string;
  readonly countryCode?: string;
  readonly admin1?: string;
  readonly population?: number;
}

/**
 * A location after resolution: a point that exists, an identity derived from
 * it, and whatever context the input carried.
 *
 * `timezone` is `'auto'` for the coordinates path — the source puts the series
 * on the location's own axis, which is the one thing that must never be left
 * unset (stage-three.md, section 2.2). `elevationMetres` is `null` there for
 * the same reason `place` is: nothing measured it.
 */
export interface ResolvedLocation {
  readonly id: LocationId;
  readonly coordinates: Coordinates;
  readonly timezone: 'auto' | string;
  readonly elevationMetres: number | null;
  readonly place: PlaceContext | null;
}

/**
 * Why a location could not be resolved. Every code is also a `ReasonCode`: the
 * client already has a name for each of these, and a second vocabulary for the
 * same three failures would have to be translated somewhere.
 */
export const LOCATION_ERROR_CODES = [
  'INVALID_COORDINATES',
  'LOCATION_NOT_FOUND',
  'PROVIDER_UNAVAILABLE',
] as const;

export type LocationErrorCode = (typeof LOCATION_ERROR_CODES)[number];

export type LocationError = DomainError<LocationErrorCode>;
