import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import type { PlaceLookupPort } from '../src/modules/weather/ports/place-lookup.port';
import type { SeriesPort } from '../src/modules/weather/ports/series.port';
import { CAPABILITY_PORT_TOKENS, PLACE_LOOKUP_PORT } from '../src/modules/weather/ports/tokens';

/**
 * The application as it really starts. The unit tests bind the module on its
 * own; this one checks that `AppModule` imports it at all, that the recorded
 * sources are what a plain `npm run start:dev` gets, and that the whole path
 * answers without a socket (the setup file would fail the test if one opened).
 */
describe('Weather sources (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('binds the recorded sources for every capability and for place lookup', () => {
    expect(app.get<SeriesPort>(CAPABILITY_PORT_TOKENS.forecast).sourceId).toBe('recorded-forecast');
    expect(app.get<SeriesPort>(CAPABILITY_PORT_TOKENS.marine).sourceId).toBe('recorded-marine');
    expect(app.get<SeriesPort>(CAPABILITY_PORT_TOKENS.archive).sourceId).toBe('recorded-archive');
    expect(app.get<PlaceLookupPort>(PLACE_LOOKUP_PORT).sourceId).toBe('recorded-lookup');
  });

  it('answers a forecast for a recorded location on today’s axis', async () => {
    const result = await app.get<SeriesPort>(CAPABILITY_PORT_TOKENS.forecast).fetch({
      capability: 'forecast',
      location: { latitude: 38.7167, longitude: -9.1333 },
      metrics: ['temperature_2m', 'wind_speed_10m'],
      horizon: { kind: 'forecast', forecastDays: 7 },
      timezone: 'auto',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.hourly.time).toHaveLength(168);

    // The axis is anchored on the local date of the location, which is one day
    // ahead of UTC for part of every day: the assertion is "today, where the
    // fixture is", not "today in UTC".
    const served = Date.parse(`${result.value.hourly.time[0]?.slice(0, 10)}T00:00:00Z`);
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

    expect(Math.abs(served - today)).toBeLessThanOrEqual(86_400_000);
  });

  it('answers a place lookup from a recording', async () => {
    const result = await app.get<PlaceLookupPort>(PLACE_LOOKUP_PORT).lookup({ name: 'Lisbon' });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value[0]?.name : undefined).toBe('Lisbon');
  });
});
