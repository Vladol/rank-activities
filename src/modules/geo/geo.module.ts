import { Module } from '@nestjs/common';

import { METRICS, type MetricsRegistry } from '../../common/metrics/metrics.registry';
import { DATABASE, type Database } from '../../infrastructure/db/database';
import { ActivitiesModule } from '../activities/activities.module';
import { WeatherModule } from '../weather/weather.module';
import { DbLocationProfileStore } from './adapters/db-profile.store';
import { DbLocationStore } from './adapters/db-location.store';
import { InMemoryLocationProfileStore } from './adapters/in-memory-profile.store';
import { InMemoryLocationStore } from './adapters/in-memory-location.store';
import { LocationProfileService } from './location-profile.service';
import { LocationResolverService } from './location-resolver.service';
import { MarineProbeService } from './marine-probe.service';
import { LOCATION_PROFILE_STORE } from './ports/location-profile.port';
import { LOCATION_STORE } from './ports/location-store.port';
import { SnowSeasonService } from './snow-season.service';

/**
 * Where a request stops being a string and becomes a place we know things
 * about: resolution, identity, and the applicability profile that decides what
 * is even worth asking the weather about.
 *
 * Both stores are durable when one is configured and in-process when not, and
 * the two lines below are the whole of that choice — which is what the ports
 * were for. Without a store the two-phase marine probe cannot terminate, so a
 * deployment that wants surfing at an inland location to settle on
 * `NO_COASTLINE_NEARBY` rather than on missing data needs `DATABASE_URL`.
 *
 * `WeatherModule.forRoot()` with no arguments is the same module object the
 * root imports, so both share one set of ports. Which source each port binds to
 * is read from the environment at that point, not from the argument, so nothing
 * about the configuration is decided here.
 */
@Module({
  imports: [ActivitiesModule, WeatherModule.forRoot()],
  providers: [
    {
      provide: LOCATION_PROFILE_STORE,
      useFactory: (db: Database | undefined, metrics: MetricsRegistry) =>
        db === undefined
          ? new InMemoryLocationProfileStore()
          : new DbLocationProfileStore(db, metrics),
      inject: [{ token: DATABASE, optional: true }, METRICS],
    },
    {
      provide: LOCATION_STORE,
      useFactory: (db: Database | undefined) =>
        db === undefined ? new InMemoryLocationStore() : new DbLocationStore(db),
      inject: [{ token: DATABASE, optional: true }],
    },
    LocationResolverService,
    MarineProbeService,
    SnowSeasonService,
    LocationProfileService,
  ],
  exports: [
    LocationResolverService,
    LocationProfileService,
    LOCATION_PROFILE_STORE,
    LOCATION_STORE,
  ],
})
export class GeoModule {}
