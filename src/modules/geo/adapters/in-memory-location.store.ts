import { Injectable } from '@nestjs/common';

import type { ResolvedLocation } from '../../../domain/location/resolved-location';
import type { LocationId } from '../../../domain/shared/branded';
import type { LocationStorePort } from '../ports/location-store.port';

/**
 * Places in the process's own memory: what is bound when no store is
 * configured, which is a supported way to run this service. Everything it holds
 * is one outbound call away from being recovered, which is exactly why losing it
 * is affordable (data-model.md, section 0).
 */
@Injectable()
export class InMemoryLocationStore implements LocationStorePort {
  private readonly locations = new Map<LocationId, ResolvedLocation>();

  find(locationId: LocationId): Promise<ResolvedLocation | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  save(location: ResolvedLocation): Promise<void> {
    this.locations.set(location.id, location);

    return Promise.resolve();
  }
}
