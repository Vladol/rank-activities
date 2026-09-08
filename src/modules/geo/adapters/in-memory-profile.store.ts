import { Injectable } from '@nestjs/common';

import type { LocationProfile } from '../../../domain/location/location-profile';
import type { LocationId } from '../../../domain/shared/branded';
import type { LocationProfilePort } from '../ports/location-profile.port';

/**
 * Profiles in the process's own memory: the first implementation of the port,
 * and the only one until `08-add-data-persistence`.
 *
 * It is enough for everything this change decides except one thing — a probe
 * candidacy has to survive to the next day to be confirmed, and this store
 * does not survive a restart. A process restarted more often than daily leaves
 * surfing at an inland location reporting missing data forever, which is
 * understated rather than wrong (design.md, "Risks / Trade-offs").
 */
@Injectable()
export class InMemoryLocationProfileStore implements LocationProfilePort {
  private readonly profiles = new Map<LocationId, LocationProfile>();

  get size(): number {
    return this.profiles.size;
  }

  find(locationId: LocationId): Promise<LocationProfile | undefined> {
    return Promise.resolve(this.profiles.get(locationId));
  }

  save(profile: LocationProfile): Promise<void> {
    this.profiles.set(profile.locationId, profile);

    return Promise.resolve();
  }
}
