import { describe, expect, it } from 'vitest';

import type { Horizon } from './ports/contracts';
import { MetricPlannerService } from './metric-planner.service';

const LOCATION = { latitude: 38.72, longitude: -9.15 };
const HORIZON: Horizon = { kind: 'forecast', forecastDays: 7 };

const planner = new MetricPlannerService();

function plan(requirements: Parameters<MetricPlannerService['plan']>[0]['requirements']) {
  return planner.plan({ requirements, location: LOCATION, horizon: HORIZON, timezone: 'auto' });
}

function requestFor(
  result: ReturnType<MetricPlannerService['plan']>,
  capability: 'forecast' | 'marine' | 'archive',
) {
  return result.ok
    ? result.value.requests.find((request) => request.capability === capability)
    : undefined;
}

describe('the union of what applicable activities declare', () => {
  it('asks each capability for the metrics it serves', () => {
    const result = plan(['temperature_2m', 'wave_height']);

    expect(result.ok).toBe(true);
    expect(requestFor(result, 'forecast')?.metrics).toEqual(['temperature_2m']);
    expect(requestFor(result, 'marine')?.metrics).toEqual(['wave_height']);
  });

  it('requests a metric several activities share exactly once', () => {
    // Three applicable activities all declaring air temperature.
    const result = plan(['temperature_2m', 'temperature_2m', 'temperature_2m', 'cloud_cover']);

    expect(requestFor(result, 'forecast')?.metrics).toEqual(['temperature_2m', 'cloud_cover']);
  });

  it('carries the location, horizon and timezone into every request', () => {
    const result = plan(['temperature_2m', 'wave_height']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const request of result.value.requests) {
        expect(request.location).toEqual(LOCATION);
        expect(request.horizon).toEqual(HORIZON);
        expect(request.timezone).toBe('auto');
      }
    }
  });

  it('orders metrics by the dictionary, so two equal plans are byte-equal', () => {
    const one = plan(['cloud_cover', 'temperature_2m']);
    const other = plan(['temperature_2m', 'cloud_cover']);

    expect(one).toEqual(other);
  });

  it('plans nothing at all when no activity is applicable', () => {
    const result = plan([]);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.requests).toEqual([]);
  });
});

describe('a capability nothing needs', () => {
  it('produces no marine plan item for an inland location', () => {
    // Prague: surfing is not applicable, so nothing declares a wave metric.
    const result = plan(['temperature_2m', 'snow_depth', 'cloud_cover']);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.requests.map((request) => request.capability)).toEqual([
      'forecast',
    ]);
    expect(requestFor(result, 'marine')).toBeUndefined();
  });
});

describe('a derived metric', () => {
  it('is requested as its inputs and never as itself', () => {
    const result = plan(['FRESH_COLD_SNOWFALL']);

    expect(requestFor(result, 'forecast')?.metrics).toEqual(['snowfall', 'temperature_2m']);
    expect(JSON.stringify(requestFor(result, 'forecast'))).not.toContain('FRESH_COLD_SNOWFALL');
  });

  it('is reported separately, so the caller knows to compute it after the fetch', () => {
    const result = plan(['FRESH_COLD_SNOWFALL', 'temperature_2m']);

    expect(result.ok && result.value.derived).toEqual(['FRESH_COLD_SNOWFALL']);
  });

  it('reaches across capabilities when its inputs do', () => {
    // Offshore/onshore needs a wind direction from forecast and a wave direction from marine.
    const result = plan(['WIND_WAVE_ALIGNMENT']);

    expect(requestFor(result, 'forecast')?.metrics).toEqual(['wind_direction_10m']);
    expect(requestFor(result, 'marine')?.metrics).toEqual(['wave_direction']);
  });

  it('merges its inputs with what other activities already asked for', () => {
    const result = plan(['FREEZING_LEVEL_MARGIN', 'freezing_level_height', 'temperature_2m']);

    expect(requestFor(result, 'forecast')?.metrics).toEqual([
      'freezing_level_height',
      'temperature_2m',
    ]);
  });
});

describe('a requirement nothing can serve', () => {
  it('is an explicit error naming the metric', () => {
    const result = planner.plan({
      requirements: ['sea_level_pressure' as never],
      location: LOCATION,
      horizon: HORIZON,
      timezone: 'auto',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('UNSUPPORTED_METRIC');
    expect(!result.ok && result.error.context).toEqual({ metric: 'sea_level_pressure' });
  });

  it('is returned rather than thrown', () => {
    expect(() =>
      planner.plan({
        requirements: ['nonsense' as never],
        location: LOCATION,
        horizon: HORIZON,
        timezone: 'auto',
      }),
    ).not.toThrow();
  });
});
