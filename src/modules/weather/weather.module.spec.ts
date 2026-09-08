import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ok } from '../../domain/shared/result';
import { validateEnv } from '../../config/env.schema';
import type { Capability } from '../../domain/weather/metric';
import { channel, createSeries } from '../../domain/weather/weather-series';
import { CAPABILITY_PORT_TOKENS, PLACE_LOOKUP_PORT } from './ports/tokens';
import type { PlaceLookupPort } from './ports/place-lookup.port';
import type { SeriesPort } from './ports/series.port';
import { MetricPlannerService } from './metric-planner.service';
import { SourceRouterService } from './source-router.service';
import { RECORDED_CAPABILITY_SOURCES } from './adapters/mock/recorded-sources';
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

// `@nestjs/config` writes the validated values back into `process.env`, so a
// case that configures a source would otherwise configure the next one too.
beforeEach(() => {
  for (const key of [
    'WEATHER_PROVIDER',
    'WEATHER_FORECAST_SOURCE',
    'WEATHER_MARINE_SOURCE',
    'WEATHER_ARCHIVE_SOURCE',
  ]) {
    delete process.env[key];
  }
});

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

/** The module as the application builds it: no registry passed, so the defaults bind. */
function compileWithDefaults(env: Record<string, string> = {}) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => validateEnv(env)],
        validate: () => validateEnv(env),
      }),
      WeatherModule.forRoot(),
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

describe('the recorded sources as the development default', () => {
  it('binds them for every capability when nothing is configured', async () => {
    const moduleRef = await compileWithDefaults();

    expect(moduleRef.get(SourceRouterService).boundSources()).toEqual({
      forecast: 'recorded-forecast',
      marine: 'recorded-marine',
      archive: 'recorded-archive',
    });
  });

  it('binds them for place lookup too', async () => {
    const moduleRef = await compileWithDefaults();

    expect(moduleRef.get<PlaceLookupPort>(PLACE_LOOKUP_PORT).sourceId).toBe('recorded-lookup');
  });

  it('states how many fixtures were loaded', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      lines.push(String(message));
    });

    try {
      await compileWithDefaults();
    } finally {
      spy.mockRestore();
    }

    expect(lines.join('\n')).toMatch(/\d+ recorded fixtures loaded/);
    expect(lines.join('\n')).toContain('no source reaches the network');
    expect(lines.join('\n')).toContain('place lookup bound to source "mock"');
  });

  it('answers a recorded location through the bound forecast port', async () => {
    const moduleRef = await compileWithDefaults();
    const forecast = moduleRef.get<SeriesPort>(CAPABILITY_PORT_TOKENS.forecast);

    const result = await forecast.fetch({
      capability: 'forecast',
      location: { latitude: 38.7167, longitude: -9.1333 },
      metrics: ['temperature_2m'],
      horizon: { kind: 'forecast', forecastDays: 7 },
      timezone: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.hourly.time.length : 0).toBe(168);
  });
});

describe('a configuration that mixes a recorded source with a live one', () => {
  it('does not claim the run is offline', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      lines.push(String(message));
    });

    try {
      await compile(
        {
          mock: RECORDED_CAPABILITY_SOURCES,
          'open-meteo': { marine: () => port('live-marine', 'marine') },
        },
        { WEATHER_MARINE_SOURCE: 'open-meteo' },
      );
    } finally {
      spy.mockRestore();
    }

    expect(lines.join('\n')).toMatch(/\d+ recorded fixtures loaded/);
    expect(lines.join('\n')).not.toContain('no source reaches the network');
    expect(lines.join('\n')).toContain('still use a live source');
  });
});

describe('the record source, which is declared but not implemented', () => {
  it('refuses the start and points at the recording script', async () => {
    await expect(compileWithDefaults({ WEATHER_PROVIDER: 'record' })).rejects.toThrow(
      /scripts\/record-fixture\.ts/,
    );
  });

  it('refuses place lookup for it as well', async () => {
    await expect(
      compile(
        { record: { forecast: () => port('r', 'forecast'), marine: () => port('r', 'marine'), archive: () => port('r', 'archive') } },
        { WEATHER_PROVIDER: 'record' },
      ),
    ).rejects.toThrow(/place lookup/);
  });
});
