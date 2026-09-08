import { describe, expect, it } from 'vitest';

import { hasMetric, isAllAbsent, valueAt, valuesOf } from '../../../../domain/weather/weather-series';
import { readFixtureBody } from '../mock/fixture-files';
import { parseOpenMeteoBody } from './open-meteo.schema';
import { mapOpenMeteoResponse } from './open-meteo.mapper';

const FETCHED_AT = '2026-09-08T09:00:00.000Z';

function map(fixture: string, capability: 'forecast' | 'marine' | 'archive' = 'forecast') {
  const parsed = parseOpenMeteoBody(readFixtureBody(fixture));

  if (!parsed.ok) {
    throw new Error(`${fixture} did not parse: ${parsed.error.message}`);
  }

  const mapped = mapOpenMeteoResponse(parsed.value, {
    sourceId: 'recorded',
    capability,
    fetchedAt: FETCHED_AT,
  });

  if (!mapped.ok) {
    throw new Error(`${fixture} did not map: ${mapped.error.message}`);
  }

  return { raw: parsed.value, series: mapped.value };
}

describe('the raw Open-Meteo response to domain mapper', () => {
  it('brings wind speed across the port in metres per second, not km/h', () => {
    const { raw, series } = map('lisbon-surf.json');
    const recorded = raw.hourly?.wind_speed_10m?.[0] as number;

    expect(raw.hourly_units?.wind_speed_10m).toBe('km/h');
    expect(valueAt(series.hourly, 'wind_speed_10m', 0)).toBeCloseTo((recorded * 1000) / 3600, 9);
  });

  it('brings visibility across the port in kilometres, not metres', () => {
    const { raw, series } = map('lisbon-surf.json');
    const recorded = raw.hourly?.visibility?.[0] as number;

    expect(raw.hourly_units?.visibility).toBe('m');
    expect(valueAt(series.hourly, 'visibility', 0)).toBeCloseTo(recorded / 1000, 9);
  });

  it('leaves snowfall in centimetres beside snow depth in metres', () => {
    const { raw, series } = map('chamonix-winter-ski.json', 'archive');

    expect(raw.hourly_units?.snowfall).toBe('cm');
    expect(raw.hourly_units?.snow_depth).toBe('m');
    expect(valueAt(series.hourly, 'snowfall', 0)).toBe(raw.hourly?.snowfall?.[0]);
    expect(valueAt(series.hourly, 'snow_depth', 0)).toBe(raw.hourly?.snow_depth?.[0]);
    expect(valuesOf(series.hourly, 'snow_depth')?.some((value) => (value ?? 0) > 0.7)).toBe(true);
  });

  it('reads a naive timestamp against utc_offset_seconds, never as UTC', () => {
    const { raw, series } = map('queenstown-nz-ski.json');
    const naive = raw.hourly?.time[0] as string;
    const mapped = series.hourly.time[0] as string;

    // Queenstown is UTC+12: reading the naive string as UTC would move the
    // instant by half a day (stage-three.md, section 2.2).
    expect(raw.utc_offset_seconds).not.toBe(0);
    expect(mapped).toContain(naive.slice(0, 16));
    expect(Date.parse(mapped)).toBe(Date.parse(`${naive}Z`) - raw.utc_offset_seconds * 1000);
    expect(Date.parse(mapped)).not.toBe(Date.parse(`${naive}Z`));
  });

  it('keeps the daily axis on local dates', () => {
    const { raw, series } = map('lisbon-surf.json');

    expect(series.daily.time[0]).toBe(raw.daily?.time[0]);
  });

  it('maps a hole in a series to an absent value, never to zero', () => {
    const { series } = map('chamonix-winter-ski.json', 'archive');
    const visibility = valuesOf(series.hourly, 'visibility');

    expect(visibility).toBeDefined();
    expect(visibility?.every((value) => value === null)).toBe(true);
    expect(visibility?.some((value) => value === 0)).toBe(false);
  });

  it('distinguishes a series that is present and empty from one that is missing', () => {
    const { series } = map('marine-prague-inland.json', 'marine');

    expect(hasMetric(series.hourly, 'wave_height')).toBe(true);
    expect(isAllAbsent(series.hourly, 'wave_height')).toBe(true);
    expect(hasMetric(series.hourly, 'wave_period')).toBe(false);
  });

  it('reports the grid node the source answered for, not the coordinates asked about', () => {
    const { raw, series } = map('lisbon-surf.json');

    expect(series.provenance[0]?.gridPoint).toEqual({
      latitude: raw.latitude,
      longitude: raw.longitude,
      elevationMetres: raw.elevation,
    });
    expect(series.provenance[0]?.sourceId).toBe('recorded');
    expect(series.provenance[0]?.fetchedAt).toBe(FETCHED_AT);
  });

  it('folds the daily aggregate names onto the metric they aggregate', () => {
    const { raw, series } = map('lisbon-surf.json');

    expect(valueAt(series.daily, 'precipitation', 0)).toBe(raw.daily?.precipitation_sum?.[0]);
    expect(valueAt(series.daily, 'snowfall', 0)).toBe(raw.daily?.snowfall_sum?.[0]);
    expect(valueAt(series.daily, 'wind_speed_10m', 0)).toBeCloseTo(
      ((raw.daily?.wind_speed_10m_max?.[0] as number) * 1000) / 3600,
      9,
    );
  });

  it('refuses a response whose unit it cannot convert rather than guessing', () => {
    const parsed = parseOpenMeteoBody(readFixtureBody('lisbon-surf.json'));

    if (!parsed.ok) {
      throw new Error('the fixture must parse');
    }

    const corrupted = {
      ...parsed.value,
      hourly_units: { ...parsed.value.hourly_units, wind_speed_10m: 'kn' },
    };

    const mapped = mapOpenMeteoResponse(corrupted, {
      sourceId: 'recorded',
      capability: 'forecast',
      fetchedAt: FETCHED_AT,
    });

    expect(mapped.ok).toBe(false);
    expect(mapped.ok ? undefined : mapped.error.code).toBe('SCHEMA_MISMATCH');
  });
});
