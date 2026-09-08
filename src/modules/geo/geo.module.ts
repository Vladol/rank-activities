import { Module } from '@nestjs/common';

import { ActivitiesModule } from '../activities/activities.module';
import { WeatherModule } from '../weather/weather.module';
import { InMemoryLocationProfileStore } from './adapters/in-memory-profile.store';
import { LocationProfileService } from './location-profile.service';
import { LocationResolverService } from './location-resolver.service';
import { MarineProbeService } from './marine-probe.service';
import { LOCATION_PROFILE_STORE } from './ports/location-profile.port';
import { SnowSeasonService } from './snow-season.service';

/**
 * Where a request stops being a string and becomes a place we know things
 * about: resolution, identity, and the applicability profile that decides what
 * is even worth asking the weather about.
 *
 * The profile store is bound to the in-process implementation. Swapping it for
 * the durable one is `08-add-data-persistence` and touches this line only —
 * which is the point of the port, and also the reason this change is not
 * finished until that one lands (design.md, "Risks / Trade-offs").
 *
 * `WeatherModule.forRoot()` with no arguments is the same module object the
 * root imports, so both share one set of ports. Which source each port binds to
 * is read from the environment at that point, not from the argument, so nothing
 * about the configuration is decided here.
 */
@Module({
  imports: [ActivitiesModule, WeatherModule.forRoot()],
  providers: [
    { provide: LOCATION_PROFILE_STORE, useClass: InMemoryLocationProfileStore },
    LocationResolverService,
    MarineProbeService,
    SnowSeasonService,
    LocationProfileService,
  ],
  exports: [LocationResolverService, LocationProfileService, LOCATION_PROFILE_STORE],
})
export class GeoModule {}
