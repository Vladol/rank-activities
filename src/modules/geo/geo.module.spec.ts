import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { validateEnv } from '../../config/env.schema';
import { locationId } from '../../domain/shared/coordinates';
import { ActivitiesModule } from '../activities/activities.module';
import { WeatherModule } from '../weather/weather.module';
import { GeoModule } from './geo.module';
import { LocationProfileService } from './location-profile.service';
import { LocationResolverService } from './location-resolver.service';
import { LOCATION_PROFILE_STORE } from './ports/location-profile.port';
import { profiled } from '../../../test/support/profile';

/** The coordinates the series recordings were made at, not the geocoded ones. */
const LISBON = { latitude: 38.7167, longitude: -9.1333 };

async function boot() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      // The local `.env` is not read: this module runs on recordings, and a
      // developer pointing their own environment at the live API must not
      // change what this test binds (as in `weather.module.spec.ts`).
      ConfigModule.forRoot({
        isGlobal: true,
        cache: false,
        ignoreEnvFile: true,
        validate: validateEnv,
      }),
      ActivitiesModule,
      WeatherModule.forRoot(),
      GeoModule,
    ],
  }).compile();

  return moduleRef;
}

describe('the geo module', () => {
  it('resolves a place name through the bound lookup source', async () => {
    const moduleRef = await boot();
    const lisbon = await moduleRef.get(LocationResolverService).resolve({
      kind: 'name',
      name: 'Lisbon',
    });

    expect(lisbon.ok).toBe(true);
    expect(lisbon.ok ? lisbon.value.place?.countryCode : undefined).toBe('PT');
    // The geocoder answers 38.72509, -9.1498, which rounds to a different grid
    // key than the 38.7167, -9.1333 the series fixtures were recorded at. The
    // series recordings for the geocoded point belong to `06-add-open-meteo-source`;
    // until then a name resolves but has no recorded weather behind it.
    expect(lisbon.ok ? lisbon.value.id : undefined).toBe('38.73,-9.15');

    await moduleRef.close();
  });

  it('profiles a location end to end, on recorded data', async () => {
    const moduleRef = await boot();
    const profile = await profiled(moduleRef.get(LocationProfileService), {
      id: locationId(LISBON),
      coordinates: LISBON,
      timezone: 'Europe/Lisbon',
      elevationMetres: 48,
      place: null,
    });

    expect(profile.locationId).toBe('38.72,-9.13');
    expect(profile.evidence.marineCoverage?.covered).toBe(true);
    expect(profile.evidence.snowSeason?.basis).toBe('archive');

    await moduleRef.close();
  });

  it('binds the weather ports once, though two modules import them', async () => {
    // GeoModule imports WeatherModule.forRoot() and so does AppModule. Nest
    // keys a dynamic module by the object `forRoot` returned, so without the
    // cache in `weather.module.ts` this boots two sets of ports — visible here
    // as the binding factory running, and logging, twice.
    const logged: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    const moduleRef = await boot();

    spy.mockRestore();

    expect(logged.filter((line) => line.includes('recorded fixtures loaded'))).toHaveLength(1);

    await moduleRef.close();
  });

  it('binds the in-memory profile store until 08 replaces it', async () => {
    const moduleRef = await boot();

    expect(moduleRef.get(LOCATION_PROFILE_STORE)).toBeDefined();

    await moduleRef.close();
  });
});
