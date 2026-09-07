import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ok } from '../../domain/shared/result';
import { validateEnv } from '../../config/env.schema';
import type { Capability } from '../../domain/weather/metric';
import { channel, createSeries } from '../../domain/weather/weather-series';
import { CAPABILITY_PORT_TOKENS } from './ports/tokens';
import type { SeriesPort } from './ports/series.port';
import { MetricPlannerService } from './metric-planner.service';
import { SourceRouterService } from './source-router.service';
import type { SourceRegistry } from './source-selection';
import { WeatherModule } from './weather.module';

function port(sourceId: string, capability: Capability): SeriesPort {
  return {
    sourceId,
    capability,
    limits: { maxForecastDays: 16, maxPastDays: 92 },
    supports: () => true,
    fetch: () =>
      Promise.resolve(
        ok(
          createSeries({
            hourly: channel([], {}),
            provenance: [
              {
                sourceId,
                capability,
                gridPoint: { latitude: 0, longitude: 0, elevationMetres: 0 },
                fetchedAt: '2026-09-07T10:00:00Z',
                stale: false,
                metrics: [],
              },
            ],
          }),
        ),
      ),
  };
}

const RECORDED: SourceRegistry = {
  mock: {
    forecast: () => port('recorded-forecast', 'forecast'),
    marine: () => port('recorded-marine', 'marine'),
    archive: () => port('recorded-archive', 'archive'),
  },
};

function compile(registry: SourceRegistry, env: Record<string, string> = {}) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => validateEnv(env)],
        validate: () => validateEnv(env),
      }),
      WeatherModule.forRoot(registry),
    ],
  }).compile();
}

describe('binding a source per capability', () => {
  it('resolves each capability port from configuration', async () => {
    const moduleRef = await compile(RECORDED);

    expect(moduleRef.get<SeriesPort>(CAPABILITY_PORT_TOKENS.forecast).sourceId).toBe(
      'recorded-forecast',
    );
    expect(moduleRef.get<SeriesPort>(CAPABILITY_PORT_TOKENS.marine).sourceId).toBe(
      'recorded-marine',
    );
  });

  it('exposes a router that knows what is bound', async () => {
    const moduleRef = await compile(RECORDED);

    expect(moduleRef.get(SourceRouterService).boundSources()).toEqual({
      forecast: 'recorded-forecast',
      marine: 'recorded-marine',
      archive: 'recorded-archive',
    });
  });

  it('validates the horizon on a bound port before any call is made', async () => {
    const moduleRef = await compile(RECORDED);
    const bound = moduleRef.get<SeriesPort>(CAPABILITY_PORT_TOKENS.forecast);

    const result = await bound.fetch({
      capability: 'forecast',
      location: { latitude: 38.72, longitude: -9.15 },
      metrics: ['temperature_2m'],
      horizon: { kind: 'forecast', forecastDays: 30 },
      timezone: 'auto',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('HORIZON_TOO_LARGE');
  });

  it('provides the metric planner', async () => {
    const moduleRef = await compile(RECORDED);

    expect(moduleRef.get(MetricPlannerService)).toBeInstanceOf(MetricPlannerService);
  });
});

describe('a configured source with no implementation', () => {
  it('refuses the start, naming the source', async () => {
    await expect(compile(RECORDED, { WEATHER_PROVIDER: 'open-meteo' })).rejects.toThrow(
      /open-meteo/,
    );
  });

  it('names the capability it could not bind', async () => {
    await expect(compile(RECORDED, { WEATHER_MARINE_SOURCE: 'record' })).rejects.toThrow(/marine/);
  });

  it('does not fall back to the source that is implemented', async () => {
    await expect(compile(RECORDED, { WEATHER_PROVIDER: 'record' })).rejects.toThrow(
      /not implemented/i,
    );
  });

  it('binds nothing at all rather than binding what it can', async () => {
    // The whole selection fails; a half-bound module would answer some
    // questions with a source nobody chose.
    await expect(compile({}, {})).rejects.toThrow(/forecast/);
  });
});
