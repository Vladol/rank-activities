import { describe, expect, it } from 'vitest';

import {
  type Provenance,
  channel,
  createSeries,
  hasMetric,
  isAllAbsent,
  provenanceOf,
  valueAt,
  valuesOf,
} from './weather-series';

const LISBON_GRID: Provenance = {
  sourceId: 'open-meteo-forecast',
  capability: 'forecast',
  // The node the source answered for, not the coordinates we asked about.
  gridPoint: { latitude: 38.75, longitude: -9.125, elevationMetres: 26 },
  fetchedAt: '2026-09-07T10:00:00Z',
  stale: false,
  metrics: ['temperature_2m', 'visibility'],
};

/** Four hours, two of them missing in the middle. */
function seriesWithGaps() {
  return createSeries({
    hourly: channel(
      ['2026-09-07T00:00', '2026-09-07T01:00', '2026-09-07T02:00', '2026-09-07T03:00'],
      {
        temperature_2m: [18.4, null, null, 17.1],
        visibility: [24.14, 24.14, 20.0, 18.5],
      },
    ),
    provenance: [LISBON_GRID],
  });
}

describe('a series with gaps', () => {
  it('keeps its length: absence does not shorten the axis', () => {
    const series = seriesWithGaps();

    expect(series.hourly.time).toHaveLength(4);
    expect(valuesOf(series.hourly, 'temperature_2m')).toHaveLength(4);
  });

  it('keeps absence in the slots it arrived in, and fills none of them', () => {
    const series = seriesWithGaps();

    expect(valuesOf(series.hourly, 'temperature_2m')).toEqual([18.4, null, null, 17.1]);
    expect(valueAt(series.hourly, 'temperature_2m', 1)).toBeNull();
    expect(valueAt(series.hourly, 'temperature_2m', 3)).toBe(17.1);
  });

  it('distinguishes a slot outside the axis from a recorded gap', () => {
    const series = seriesWithGaps();

    expect(valueAt(series.hourly, 'temperature_2m', 1)).toBeNull();
    expect(valueAt(series.hourly, 'temperature_2m', 9)).toBeUndefined();
  });

  it('refuses a channel whose values do not line up with its time axis', () => {
    expect(() =>
      channel(['2026-09-07T00:00', '2026-09-07T01:00'], { temperature_2m: [18.4] }),
    ).toThrow(/temperature_2m/);
  });
});

describe('an entirely absent series', () => {
  it('is present and empty, not missing', () => {
    // Marine over land: a complete time grid in which every value is null.
    const series = createSeries({
      hourly: channel(['2026-09-07T00:00', '2026-09-07T01:00'], {
        wave_height: [null, null],
      }),
      provenance: [{ ...LISBON_GRID, capability: 'marine', metrics: ['wave_height'] }],
    });

    expect(hasMetric(series.hourly, 'wave_height')).toBe(true);
    expect(isAllAbsent(series.hourly, 'wave_height')).toBe(true);
    expect(valuesOf(series.hourly, 'wave_height')).toHaveLength(2);
  });

  it('reads differently from a metric the source never returned', () => {
    const series = createSeries({
      hourly: channel(['2026-09-07T00:00'], { wave_height: [null] }),
      provenance: [LISBON_GRID],
    });

    expect(hasMetric(series.hourly, 'wave_height')).toBe(true);
    expect(hasMetric(series.hourly, 'wave_period')).toBe(false);
    expect(valuesOf(series.hourly, 'wave_period')).toBeUndefined();
    expect(isAllAbsent(series.hourly, 'wave_period')).toBe(false);
  });
});

describe('provenance', () => {
  it('reports the grid point the source answered for', () => {
    const series = seriesWithGaps();
    const origin = provenanceOf(series, 'open-meteo-forecast');

    expect(origin?.gridPoint).toEqual({ latitude: 38.75, longitude: -9.125, elevationMetres: 26 });
  });

  it('has nowhere to record the requested coordinates, so they cannot be mistaken for the answer', () => {
    const series = seriesWithGaps();

    expect(Object.keys(series.provenance[0]?.gridPoint ?? {}).toSorted()).toEqual([
      'elevationMetres',
      'latitude',
      'longitude',
    ]);
  });

  it('carries the elevation of the answered node, so a derived metric needs no location record', () => {
    const series = seriesWithGaps();

    expect(provenanceOf(series, 'open-meteo-forecast')?.gridPoint.elevationMetres).toBe(26);
  });

  it('carries when the data was obtained and whether it is stale', () => {
    const series = seriesWithGaps();
    const origin = provenanceOf(series, 'open-meteo-forecast');

    expect(origin?.fetchedAt).toBe('2026-09-07T10:00:00Z');
    expect(origin?.stale).toBe(false);
  });

  it('refuses a series with no provenance at all', () => {
    expect(() => createSeries({ hourly: channel([], {}), provenance: [] })).toThrow(/provenance/);
  });
});

describe('the daily channel', () => {
  it('exists alongside the hourly one and is empty when the source sent none', () => {
    const series = seriesWithGaps();

    expect(series.daily.time).toEqual([]);
    expect(hasMetric(series.daily, 'temperature_2m_max')).toBe(false);
  });

  it('carries daily metrics on their own axis', () => {
    const series = createSeries({
      daily: channel(['2026-09-07', '2026-09-08'], {
        temperature_2m_max: [24.9, null],
        precipitation_hours: [0, 3],
      }),
      provenance: [{ ...LISBON_GRID, metrics: ['temperature_2m_max', 'precipitation_hours'] }],
    });

    expect(series.daily.time).toHaveLength(2);
    expect(valueAt(series.daily, 'temperature_2m_max', 1)).toBeNull();
    expect(valueAt(series.daily, 'precipitation_hours', 1)).toBe(3);
    expect(series.hourly.time).toEqual([]);
  });
});
