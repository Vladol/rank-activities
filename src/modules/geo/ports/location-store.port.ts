import type { ResolvedLocation } from '../../../domain/location/resolved-location';
import type { LocationId } from '../../../domain/shared/branded';

/**
 * Where a resolved place is kept.
 *
 * It exists because the profile of a place refers to the place: a profile with
 * no location behind it is evidence about nothing. It is also the first half of
 * "expensive to re-derive" — re-resolving a name costs an outbound call, and the
 * result changes about as often as a city moves.
 *
 * `save` is idempotent by identity, and identity is computed from the rounded
 * coordinates before anything is written (design.md, Decision 3).
 */
export interface LocationStorePort {
  find(locationId: LocationId): Promise<ResolvedLocation | undefined>;
  save(location: ResolvedLocation): Promise<void>;
}

export const LOCATION_STORE: unique symbol = Symbol('LocationStorePort');
