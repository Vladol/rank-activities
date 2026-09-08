import type { LocationProfile } from '../../../domain/location/location-profile';
import type { LocationId } from '../../../domain/shared/branded';

/**
 * Where location profiles live.
 *
 * The port exists before the store does, deliberately: applicability is
 * decided in this change and PostgreSQL arrives with `08-add-data-persistence`
 * (design.md, Decision 5). Until then the implementation is in-process, and
 * the two-phase probe's confirmation is not reachable across a restart — the
 * risk this change records rather than hides.
 *
 * `find` answers `undefined` for a location nothing is known about. That is
 * not a failure: the caller's next move is to gather evidence.
 */
export interface LocationProfilePort {
  find(locationId: LocationId): Promise<LocationProfile | undefined>;
  save(profile: LocationProfile): Promise<void>;
}

export const LOCATION_PROFILE_STORE: unique symbol = Symbol('LocationProfilePort');
