import { describe, expect, it } from 'vitest';

import { kmhToMs, metresToKm } from '../../../../domain/weather/units';
import { isAllAbsent, valueAt, valuesOf } from '../../../../domain/weather/weather-series';
import type { SeriesRequest } from '../../ports/contracts';
import { describeSeriesPortContract } from '../../contract/weather-port.conformance';
import { readFixtureBody } from './fixture-files';
import { FixtureRegistry } from './fixture-registry';
import { RecordedSeriesSource } from './recorded-series.source';

const registry = FixtureRegistry.load();

/** A fixed instant, so a rebased axis is the same in every run. */
const NOW = Date.parse('2026-12-01T09:00:00Z');

const lines: string[] = [];

function forecast(): RecordedSeriesSource<'forecast'> {
  return new RecordedSeriesSource(registry, 'forecast', {
    now: () => NOW,
    log: (line) => lines.push(line),
  });
}

function marine(): RecordedSeriesSource<'marine'> {
  return new RecordedSeriesSource(registry, 'marine', { now: () => NOW });
}

function request(
  latitude: number,
  longitude: number,
  metrics: SeriesRequest['metrics'],
  capability: SeriesRequest['capability'] = 'forecast',
): SeriesRequest {
  return {
    capability,
    location: { latitude, longitude },
    metrics,
    horizon: { kind: 'forecast', forecastDays: 7 },
    timezone: 'auto',
  };
}

const lisbon = JSON.parse(readFixtureBody('lisbon-surf.json')) as {
  latitude: number;
  longitude: number;
  elevation: number;
  hourly: Record<string, (number | null)[]>;
};

describe('the recorded forecast source', () => {
  it('answers a recorded location with a series on today’s axis', async () => {
    const result = await forecast().fetch(request(38.7167, -9.1333, ['temperature_2m']));

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.hourly.time).toHaveLength(168);
    expect(result.value.hourly.time[0]).toContain('2026-12-01');
    expect(result.value.daily.time[0]).toBe('2026-12-01');
  });

  it('serves two reads on the same day byte for byte alike', async () => {
    const first = await forecast().fetch(request(38.7167, -9.1333, ['temperature_2m']));
    const second = await forecast().fetch(request(38.7167, -9.1333, ['temperature_2m']));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('reports the grid node the recording answered for, not the coordinates asked about', async () => {
    const result = await forecast().fetch(request(38.7167, -9.1333, ['temperature_2m']));

    expect(result.ok ? result.value.provenance[0]?.gridPoint : undefined).toEqual({
      latitude: lisbon.latitude,
      longitude: lisbon.longitude,
      elevationMetres: lisbon.elevation,
    });
  });

  it('declares only what it can serve', () => {
    const source = forecast();

    expect(source.supports('snow_depth')).toBe(true);
    expect(source.supports('wave_height')).toBe(false);
    expect(marine().supports('temperature_2m')).toBe(false);
  });

  it('answers a coordinate no fixture covers with an explicit miss', async () => {
    const result = await forecast().fetch(request(12.34, 56.78, ['temperature_2m']));

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('12.34:56.78');
  });

  it('keeps a marine series over land present and entirely empty', async () => {
    const result = await marine().fetch(request(50.0875, 14.4213, ['wave_height'], 'marine'));

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(isAllAbsent(result.value.hourly, 'wave_height')).toBe(true);
    expect(valuesOf(result.value.hourly, 'wave_height')).toHaveLength(72);
  });

  it('keeps a flat sea distinguishable from an absent one', async () => {
    const result = await marine().fetch({
      capability: 'marine',
      location: { latitude: 46.4825, longitude: 30.7233 },
      metrics: ['wave_height'],
      horizon: { kind: 'window', startDate: '2025-07-09', endDate: '2025-07-12' },
      timezone: 'auto',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(isAllAbsent(result.value.hourly, 'wave_height')).toBe(false);
    expect(valueAt(result.value.hourly, 'wave_height', 0)).toBeGreaterThan(0);
  });
});

describe('a request that names explicit dates', () => {
  it('is served on the dates that were recorded, not on today', async () => {
    const result = await marine().fetch({
      capability: 'marine',
      location: { latitude: 46.4825, longitude: 30.7233 },
      metrics: ['wave_height'],
      horizon: { kind: 'window', startDate: '2025-07-09', endDate: '2025-07-12' },
      timezone: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.hourly.time[0] : '').toContain('2025-07-08');
    expect(result.ok ? result.value.daily.time[0] : '').toBe('2025-07-08');
  });

  it('answers a window no recording covers with an explicit miss', async () => {
    const result = await marine().fetch({
      capability: 'marine',
      location: { latitude: 46.4825, longitude: 30.7233 },
      metrics: ['wave_height'],
      horizon: { kind: 'window', startDate: '2024-01-01', endDate: '2024-01-07' },
      timezone: 'auto',
    });

    expect(result.ok).toBe(false);
  });
});

describe('a metric the recording does not carry', () => {
  it('is a failure, not a series that quietly leaves it out', async () => {
    // The source serves sea surface temperature elsewhere; the Prague
    // recording asked the marine endpoint for wave height alone.
    expect(marine().supports('sea_surface_temperature')).toBe(true);

    const result = await marine().fetch(
      request(50.0875, 14.4213, ['wave_height', 'sea_surface_temperature'], 'marine'),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('SCHEMA_MISMATCH');
    expect(result.ok ? undefined : result.error.context?.missing).toBe('sea_surface_temperature');
  });
});

describe('the recorded failure fixtures', () => {
  it('replays a 400 with a JSON body as an unexpected status', async () => {
    const result = await forecast().fetch(request(999, -9.1333, ['temperature_2m']));

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('UNEXPECTED_STATUS');
    expect(result.ok ? undefined : result.error.context?.status).toBe(400);
  });

  it('keeps the reason the source wrote out of the error it returns', async () => {
    lines.length = 0;

    const result = await forecast().fetch(request(999, -9.1333, ['temperature_2m']));

    expect(JSON.stringify(result)).not.toContain('Latitude must be in range');
    expect(lines.join('\n')).toContain('Latitude must be in range');
  });

  it('replays a 200 with an empty body as a malformed body, not as a crash', async () => {
    const result = await forecast().fetch(request(0, 0, ['temperature_2m']));

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('MALFORMED_BODY');
  });

  it('never throws, whatever the recording holds', async () => {
    for (const coordinates of [
      [999, -9.1333],
      [0, 0],
      [12.34, 56.78],
    ] as const) {
      await expect(
        forecast().fetch(request(coordinates[0], coordinates[1], ['temperature_2m'])),
      ).resolves.toBeDefined();
    }
  });
});

describeSeriesPortContract('the recorded forecast source', {
  createPort: forecast,
  unsupportedMetric: 'wave_height',
  readSourceLog: () => lines,
  series: [
    {
      name: 'lisbon',
      request: request(38.7167, -9.1333, ['temperature_2m', 'wind_speed_10m', 'visibility']),
      expectHourly: {
        temperature_2m: lisbon.hourly.temperature_2m ?? [],
        wind_speed_10m: (lisbon.hourly.wind_speed_10m ?? []).map((value) =>
          value === null ? null : kmhToMs(value),
        ),
        visibility: (lisbon.hourly.visibility ?? []).map((value) =>
          value === null ? null : metresToKm(value),
        ),
      },
      expectGridPoint: {
        latitude: lisbon.latitude,
        longitude: lisbon.longitude,
        elevationMetres: lisbon.elevation,
      },
    },
    {
      name: 'chamonix in deep winter, from the archive',
      request: request(45.9237, 6.8694, ['snow_depth', 'visibility']),
      // ERA5 carries no visibility at all: the metric comes back present and
      // entirely empty rather than filled with zeroes.
      expectAllAbsent: ['visibility'],
    },
  ],
  failures: [
    {
      name: 'a 400 with a JSON error envelope',
      request: request(999, -9.1333, ['temperature_2m']),
      expectCode: 'UNEXPECTED_STATUS',
      sourceText: 'Latitude must be in range',
    },
    {
      name: 'a 200 with an empty body',
      request: request(0, 0, ['temperature_2m']),
      expectCode: 'MALFORMED_BODY',
    },
    {
      name: 'a coordinate no fixture covers',
      request: request(12.34, 56.78, ['temperature_2m']),
      expectCode: 'TRANSPORT_FAILURE',
    },
  ],
});
