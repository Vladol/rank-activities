import { describe, expect, it } from 'vitest';

import { ok } from '../../domain/shared/result';
import type { Capability, MetricCode } from '../../domain/weather/metric';
import { channel, createSeries } from '../../domain/weather/weather-series';
import type { SeriesRequest } from './ports/contracts';
import type { SeriesPort } from './ports/series.port';
import { SourceRouterService } from './source-router.service';

function fakePort(
  sourceId: string,
  capability: Capability,
  served: readonly MetricCode[],
): SeriesPort {
  return {
    sourceId,
    capability,
    limits: { maxForecastDays: 16, maxPastDays: 92 },
    supports: (metric) => served.includes(metric),
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
                metrics: served,
              },
            ],
          }),
        ),
      ),
  };
}

const FORECAST = fakePort('open-meteo-forecast', 'forecast', ['temperature_2m', 'cloud_cover']);
const MARINE = fakePort('other-vendor-marine', 'marine', ['wave_height']);

function request(capability: Capability, metrics: readonly MetricCode[]): SeriesRequest {
  return {
    capability,
    location: { latitude: 38.72, longitude: -9.15 },
    metrics,
    horizon: { kind: 'forecast', forecastDays: 7 },
    timezone: 'auto',
  };
}

describe('the capability-to-source table', () => {
  it('returns the source bound to a capability', () => {
    const router = new SourceRouterService([FORECAST, MARINE]);

    const port = router.portFor('forecast');

    expect(port.ok && port.value.sourceId).toBe('open-meteo-forecast');
  });

  it('lets two capabilities be served by different vendors', () => {
    const router = new SourceRouterService([FORECAST, MARINE]);

    expect(router.portFor('forecast').ok && router.portFor('marine').ok).toBe(true);
    expect(router.boundSources()).toEqual({
      forecast: 'open-meteo-forecast',
      marine: 'other-vendor-marine',
    });
  });

  it('refuses a port bound to a capability it does not serve', () => {
    expect(() => new SourceRouterService([fakePort('confused', 'marine', [])], ['forecast'])).toThrow(
      /confused/,
    );
  });
});

describe('an unbound capability', () => {
  it('is an explicit error naming it', () => {
    const router = new SourceRouterService([FORECAST]);

    const port = router.portFor('marine');

    expect(port.ok).toBe(false);
    if (!port.ok) {
      expect(port.error.code).toBe('CAPABILITY_NOT_BOUND');
      expect(port.error.context).toEqual({ capability: 'marine' });
    }
  });

  it('never falls back to another capability source', () => {
    const router = new SourceRouterService([FORECAST]);

    expect(router.portFor('archive').ok).toBe(false);
    expect(router.boundSources()).toEqual({ forecast: 'open-meteo-forecast' });
  });

  it('is returned rather than thrown', () => {
    const router = new SourceRouterService([FORECAST]);

    expect(() => router.portFor('marine')).not.toThrow();
  });
});

describe('a metric no bound source declares', () => {
  it('is an explicit error naming the metric and its capability', () => {
    const router = new SourceRouterService([FORECAST, MARINE]);

    const checked = router.checkSupported(request('forecast', ['temperature_2m', 'visibility']));

    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.error.code).toBe('UNSUPPORTED_METRIC');
      expect(checked.error.context).toEqual({ metric: 'visibility', capability: 'forecast' });
    }
  });

  it('is not answered with a shortened metric list', () => {
    const router = new SourceRouterService([FORECAST, MARINE]);

    const checked = router.checkSupported(request('forecast', ['temperature_2m', 'visibility']));

    expect(checked.ok).toBe(false);
    expect(JSON.stringify(checked)).not.toContain('temperature_2m');
  });

  it('passes a fully supported request through unchanged', () => {
    const router = new SourceRouterService([FORECAST, MARINE]);
    const incoming = request('forecast', ['temperature_2m', 'cloud_cover']);

    expect(router.checkSupported(incoming)).toEqual({ ok: true, value: incoming });
  });

  it('reports the unbound capability rather than the metric when nothing is bound', () => {
    const router = new SourceRouterService([FORECAST]);

    const checked = router.checkSupported(request('marine', ['wave_height']));

    expect(!checked.ok && checked.error.code).toBe('CAPABILITY_NOT_BOUND');
  });
});
