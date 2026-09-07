import { describe, expect, it } from 'vitest';

import { ok } from '../../domain/shared/result';
import type { Capability } from '../../domain/weather/metric';
import type { SeriesPort } from './ports/series.port';
import {
  type SourceRegistry,
  bindCapabilitySources,
  selectSourceNames,
} from './source-selection';

function port(sourceId: string, capability: Capability): SeriesPort {
  return {
    sourceId,
    capability,
    limits: { maxForecastDays: 16, maxPastDays: 92 },
    supports: () => true,
    fetch: () => Promise.resolve(ok({ hourly: { time: [], values: {} }, daily: { time: [], values: {} }, provenance: [] })),
  };
}

const MOCK_EVERYTHING: SourceRegistry = {
  mock: {
    forecast: () => port('mock-forecast', 'forecast'),
    marine: () => port('mock-marine', 'marine'),
    archive: () => port('mock-archive', 'archive'),
  },
};

const env = (overrides: Record<string, string> = {}) => ({
  WEATHER_PROVIDER: 'mock' as const,
  ...overrides,
});

describe('selectSourceNames', () => {
  it('uses the single provider setting for every capability by default', () => {
    expect(selectSourceNames(env())).toEqual({
      forecast: 'mock',
      marine: 'mock',
      archive: 'mock',
    });
  });

  it('lets one capability be pointed at another source', () => {
    const selection = selectSourceNames(env({ WEATHER_MARINE_SOURCE: 'open-meteo' }));

    expect(selection).toEqual({ forecast: 'mock', marine: 'open-meteo', archive: 'mock' });
  });
});

describe('bindCapabilitySources', () => {
  it('binds every capability and reports what it bound', () => {
    const bound = bindCapabilitySources(selectSourceNames(env()), MOCK_EVERYTHING);

    expect(bound.ports.map((entry) => entry.sourceId)).toEqual([
      'mock-forecast',
      'mock-marine',
      'mock-archive',
    ]);
    expect(bound.log).toEqual([
      'forecast capability bound to source "mock"',
      'marine capability bound to source "mock"',
      'archive capability bound to source "mock"',
    ]);
  });

  it('refuses to start when configuration names a source with no implementation', () => {
    expect(() =>
      bindCapabilitySources(selectSourceNames(env({ WEATHER_PROVIDER: 'open-meteo' })), MOCK_EVERYTHING),
    ).toThrow(/open-meteo/);
  });

  it('names the capability as well as the source in the refusal', () => {
    expect(() =>
      bindCapabilitySources(
        selectSourceNames(env({ WEATHER_MARINE_SOURCE: 'record' })),
        MOCK_EVERYTHING,
      ),
    ).toThrow(/marine/);
  });

  it('says the source is not implemented rather than that it is unknown', () => {
    expect(() =>
      bindCapabilitySources(selectSourceNames(env({ WEATHER_PROVIDER: 'record' })), MOCK_EVERYTHING),
    ).toThrow(/not implemented/i);
  });

  it('does not fall back to a source that does exist', () => {
    let error: unknown;

    try {
      bindCapabilitySources(
        selectSourceNames(env({ WEATHER_MARINE_SOURCE: 'open-meteo' })),
        MOCK_EVERYTHING,
      );
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/falling back|using mock instead/i);
  });

  it('refuses a factory that returns a port for a different capability', () => {
    // A misregistered factory would otherwise log the wrong binding and then
    // overwrite another row of the router table.
    const misregistered: SourceRegistry = {
      mock: {
        forecast: () => port('mock-marine', 'marine'),
        marine: () => port('mock-marine', 'marine'),
        archive: () => port('mock-archive', 'archive'),
      },
    };

    expect(() => bindCapabilitySources(selectSourceNames(env()), misregistered)).toThrow(
      /forecast.*marine|marine.*forecast/,
    );
  });

  it('refuses a source that implements some capabilities but not the one asked for', () => {
    const forecastOnly: SourceRegistry = {
      'open-meteo': { forecast: () => port('open-meteo-forecast', 'forecast') },
    };

    expect(() =>
      bindCapabilitySources(selectSourceNames(env({ WEATHER_PROVIDER: 'open-meteo' })), forecastOnly),
    ).toThrow(/marine/);
  });
});
