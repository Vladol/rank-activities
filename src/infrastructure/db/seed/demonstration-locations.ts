import { Logger } from '@nestjs/common';

import { MetricsRegistry } from '../../../common/metrics/metrics.registry';
import type { ResolvedLocation } from '../../../domain/location/resolved-location';
import { locationId } from '../../../domain/shared/coordinates';
import { SeedActivityCatalogue } from '../../../modules/activities/seed-catalogue';
import { DbLocationProfileStore } from '../../../modules/geo/adapters/db-profile.store';
import { DbLocationStore } from '../../../modules/geo/adapters/db-location.store';
import { LocationProfileService } from '../../../modules/geo/location-profile.service';
import { MarineProbeService } from '../../../modules/geo/marine-probe.service';
import { SnowSeasonService } from '../../../modules/geo/snow-season.service';
import { recordedSeriesSource } from '../../../modules/weather/adapters/mock/recorded-sources';
import type { Database } from '../database';

/**
 * The places the recorded fixtures cover, so that a fresh checkout has evidence
 * for them before the first request rather than after it.
 *
 * The coordinates are the fixtures' own, rounded to the grid the identity uses;
 * a place whose coordinates missed a fixture would be seeded with a failed
 * gathering, which is worse than not seeding it.
 */
const DEMONSTRATION_LOCATIONS: readonly {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
  readonly elevationMetres: number;
}[] = [
  { name: 'Chamonix', latitude: 45.9237, longitude: 6.8694, timezone: 'Europe/Paris', elevationMetres: 1035 },
  { name: 'Lisbon', latitude: 38.7167, longitude: -9.1333, timezone: 'Europe/Lisbon', elevationMetres: 48 },
  { name: 'Prague', latitude: 50.0875, longitude: 14.4213, timezone: 'Europe/Prague', elevationMetres: 202 },
  { name: 'Tromso', latitude: 69.6496, longitude: 18.9560, timezone: 'Europe/Oslo', elevationMetres: 14 },
];

const logger = new Logger('DemonstrationLocations');

/**
 * Profiles the demonstration locations from the recorded fixtures, reaching no
 * network at all.
 *
 * It profiles each place **once**, today, and does not pretend otherwise. A
 * marine probe that found no coverage leaves surfing undecided until a probe on
 * a second day confirms it, and back-dating a probe to make the seed look
 * finished would be writing evidence for a day nobody looked
 * (spec, "Coastal applicability is confirmed by two probes on different days").
 */
export async function seedDemonstrationProfiles(db: Database): Promise<readonly string[]> {
  const service = new LocationProfileService(
    new DbLocationProfileStore(db, new MetricsRegistry()),
    new MarineProbeService(recordedSeriesSource('marine')),
    new SnowSeasonService(recordedSeriesSource('archive')),
    SeedActivityCatalogue.load(),
    new DbLocationStore(db),
  );
  const profiled: string[] = [];

  for (const place of DEMONSTRATION_LOCATIONS) {
    const location: ResolvedLocation = {
      id: locationId(place),
      coordinates: { latitude: place.latitude, longitude: place.longitude },
      timezone: place.timezone,
      elevationMetres: place.elevationMetres,
      place: { name: place.name, sourcePlaceId: `seed:${place.name.toLowerCase()}` },
    };
    const result = await service.profileFor(location);

    if (result.ok) {
      profiled.push(`${place.name} (${location.id})`);
    } else {
      // A seed that cannot warm one place is not a failed deploy: the place is
      // profiled on its first request like any other.
      logger.warn(`Could not profile ${place.name}: ${result.error.code}`);
    }
  }

  return profiled;
}
