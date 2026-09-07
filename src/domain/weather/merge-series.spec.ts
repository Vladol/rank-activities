import { describe, expect, it } from 'vitest';

import { mergeSeries } from './merge-series';
import { type Provenance, channel, createSeries, valuesOf } from './weather-series';

const FORECAST: Provenance = {
  sourceId: 'open-meteo-forecast',
  capability: 'forecast',
  gridPoint: { latitude: 38.75, longitude: -9.125, elevationMetres: 26 },
  fetchedAt: '2026-09-07T10:00:00Z',
  stale: false,
  metrics: ['temperature_2m'],
};

const MARINE: Provenance = {
  sourceId: 'open-meteo-marine',
  capability: 'marine',
  gridPoint: { latitude: 38.75, longitude: -9.25, elevationMetres: 0 },
  fetchedAt: '2026-09-07T07:00:00Z',
  stale: false,
  metrics: ['wave_height'],
};

const HOURS = ['2026-09-07T00:00', '2026-09-07T01:00'];

const forecastSeries = () =>
  createSeries({
    hourly: channel(HOURS, { temperature_2m: [18.4, null] }),
    provenance: [FORECAST],
  });

const marineSeries = () =>
  createSeries({
    hourly: channel(HOURS, { wave_height: [1.2, 1.4] }),
    provenance: [MARINE],
  });

describe('mergeSeries', () => {
  it('combines the metrics of two capabilities onto one axis', () => {
    const merged = mergeSeries(forecastSeries(), marineSeries());

    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.hourly.time).toEqual(HOURS);
      expect(valuesOf(merged.value.hourly, 'temperature_2m')).toEqual([18.4, null]);
      expect(valuesOf(merged.value.hourly, 'wave_height')).toEqual([1.2, 1.4]);
    }
  });

  it('keeps both provenance entries with their own timestamps and grid points', () => {
    const merged = mergeSeries(forecastSeries(), marineSeries());

    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.provenance).toHaveLength(2);
      expect(merged.value.provenance.map((entry) => entry.fetchedAt)).toEqual([
        '2026-09-07T10:00:00Z',
        '2026-09-07T07:00:00Z',
      ]);
      expect(merged.value.provenance.map((entry) => entry.gridPoint.longitude)).toEqual([
        -9.125, -9.25,
      ]);
    }
  });

  it('preserves absence through the merge', () => {
    const merged = mergeSeries(forecastSeries(), marineSeries());

    expect(merged.ok && valuesOf(merged.value.hourly, 'temperature_2m')?.[1]).toBeNull();
  });

  it('takes the axis of whichever side has one when the other channel is empty', () => {
    const dailyOnly = createSeries({
      daily: channel(['2026-09-07'], { temperature_2m_max: [24.9] }),
      provenance: [{ ...FORECAST, metrics: ['temperature_2m_max'] }],
    });

    const merged = mergeSeries(forecastSeries(), dailyOnly);

    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.hourly.time).toEqual(HOURS);
      expect(merged.value.daily.time).toEqual(['2026-09-07']);
    }
  });

  it('reports a metric collision instead of overwriting one side', () => {
    const other = createSeries({
      hourly: channel(HOURS, { temperature_2m: [99, 99] }),
      provenance: [{ ...MARINE, metrics: ['temperature_2m'] }],
    });

    const merged = mergeSeries(forecastSeries(), other);

    expect(merged.ok).toBe(false);
    if (!merged.ok) {
      expect(merged.error.code).toBe('METRIC_COLLISION');
      expect(merged.error.context).toEqual({ metric: 'temperature_2m', channel: 'hourly' });
    }
  });

  it('returns the collision rather than throwing it', () => {
    const other = createSeries({
      hourly: channel(HOURS, { temperature_2m: [99, 99] }),
      provenance: [MARINE],
    });

    expect(() => mergeSeries(forecastSeries(), other)).not.toThrow();
  });

  it('refuses to line up two channels recorded on different axes', () => {
    const shifted = createSeries({
      hourly: channel(['2026-09-07T06:00', '2026-09-07T07:00'], { wave_height: [1.2, 1.4] }),
      provenance: [MARINE],
    });

    const merged = mergeSeries(forecastSeries(), shifted);

    expect(merged.ok).toBe(false);
    if (!merged.ok) {
      expect(merged.error.code).toBe('TIME_AXIS_MISMATCH');
    }
  });

  it('merges a list of series in one pass', () => {
    const daily = createSeries({
      daily: channel(['2026-09-07'], { precipitation_hours: [3] }),
      provenance: [{ ...FORECAST, metrics: ['precipitation_hours'] }],
    });

    const merged = mergeSeries(forecastSeries(), marineSeries(), daily);

    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.provenance).toHaveLength(3);
      expect(valuesOf(merged.value.daily, 'precipitation_hours')).toEqual([3]);
    }
  });
});
