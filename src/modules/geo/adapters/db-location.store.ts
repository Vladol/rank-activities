import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import type { ResolvedLocation } from '../../../domain/location/resolved-location';
import type { LocationId } from '../../../domain/shared/branded';
import type { Database } from '../../../infrastructure/db/database';
import { NAMESPACE, uuidv5 } from '../../../infrastructure/db/uuid5';
import { locations } from '../../../infrastructure/db/schema/locations';
import type { LocationStorePort } from '../ports/location-store.port';

/**
 * The row identity of a place: UUIDv5 over the grid key, which is itself the
 * `LocationId` the domain computed from the rounded coordinates.
 *
 * The conversion is here and nowhere else. The domain's identifier is
 * explainable — `'38.72,-9.14'` names the point it came from — and the row's is
 * a fixed-width key the four referring tables can carry; both are computed, from
 * the same thing, before anything is written.
 */
export function locationRowId(locationId: LocationId): string {
  return uuidv5(locationId, NAMESPACE.location);
}

/**
 * Places in PostgreSQL.
 *
 * Writing is idempotent by identity and never overwrites with less: a place
 * first resolved from coordinates has no name and no country, and the row it
 * would write must not erase the ones a later resolution by name supplied.
 */
@Injectable()
export class DbLocationStore implements LocationStorePort {
  private readonly logger = new Logger(DbLocationStore.name);

  constructor(private readonly db: Database) {}

  async find(locationId: LocationId): Promise<ResolvedLocation | undefined> {
    const [row] = await this.db
      .select()
      .from(locations)
      .where(eq(locations.id, locationRowId(locationId)))
      .limit(1);

    if (row === undefined) {
      return undefined;
    }

    return {
      id: row.gridKey as LocationId,
      coordinates: { latitude: row.latitude, longitude: row.longitude },
      timezone: row.timezone,
      elevationMetres: row.elevationMetres,
      place:
        row.providerPlaceId === null
          ? null
          : {
              name: row.name,
              sourcePlaceId: row.providerPlaceId,
              ...(row.country === null ? {} : { countryCode: row.country }),
              ...(row.admin1 === null ? {} : { admin1: row.admin1 }),
              ...(row.population === null ? {} : { population: row.population }),
            },
    };
  }

  async save(location: ResolvedLocation): Promise<void> {
    await this.db
      .insert(locations)
      .values({
        id: locationRowId(location.id),
        gridKey: location.id,
        // A point resolved from raw coordinates has no name; the grid key is
        // what it is called, and inventing a city for it is the nearest-match
        // substitution the spec forbids.
        name: location.place?.name ?? location.id,
        country: location.place?.countryCode ?? null,
        admin1: location.place?.admin1 ?? null,
        latitude: location.coordinates.latitude,
        longitude: location.coordinates.longitude,
        timezone: location.timezone,
        elevationMetres: location.elevationMetres,
        population: location.place?.population ?? null,
        providerPlaceId: location.place?.sourcePlaceId ?? null,
        geocodedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: locations.id,
        // The stored row wins wherever the incoming one knows less. A request
        // made by raw coordinates resolves to a point with no name, no country
        // and `auto` for a zone, and writing those over what a geocoder once
        // supplied would lose them for good.
        set: {
          name: sql`CASE WHEN excluded.provider_place_id IS NULL THEN ${locations.name} ELSE excluded.name END`,
          country: sql`COALESCE(excluded.country, ${locations.country})`,
          admin1: sql`COALESCE(excluded.admin1, ${locations.admin1})`,
          timezone: sql`CASE WHEN excluded.timezone = 'auto' THEN ${locations.timezone} ELSE excluded.timezone END`,
          elevationMetres: sql`COALESCE(excluded.elevation_m, ${locations.elevationMetres})`,
          population: sql`COALESCE(excluded.population, ${locations.population})`,
          providerPlaceId: sql`COALESCE(excluded.provider_place_id, ${locations.providerPlaceId})`,
        },
      });

    this.logger.debug(`Stored location ${location.id}.`);
  }
}
