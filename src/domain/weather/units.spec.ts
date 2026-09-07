import { describe, expect, it } from 'vitest';

import { metric } from './metric';
import { convertToCanonical, kmhToMs, metresToKm } from './units';

describe('the three conversions of stage-three.md section 4', () => {
  it('converts wind from km/h to m/s', () => {
    expect(kmhToMs(36)).toBeCloseTo(10, 10);
    expect(kmhToMs(0)).toBe(0);
  });

  it('converts visibility from metres to kilometres', () => {
    expect(metresToKm(24140)).toBeCloseTo(24.14, 10);
    expect(metresToKm(0)).toBe(0);
  });

  it('routes a value through the pair its metric declares', () => {
    expect(convertToCanonical('km/h', metric('wind_speed_10m').canonicalUnit, 36)).toEqual({
      ok: true,
      value: 10,
    });
    expect(convertToCanonical('m', metric('visibility').canonicalUnit, 24140)).toEqual({
      ok: true,
      value: 24.14,
    });
  });
});

describe('the units that must stay as recorded', () => {
  it('leaves snowfall in centimetres', () => {
    expect(metric('snowfall').canonicalUnit).toBe('cm');
    expect(convertToCanonical('cm', 'cm', 12.5)).toEqual({ ok: true, value: 12.5 });
  });

  it('leaves snow depth in metres and does not turn it into kilometres', () => {
    // The 100x trap: snow_depth sits beside snowfall and shares neither unit.
    expect(metric('snow_depth').canonicalUnit).toBe('m');
    expect(convertToCanonical('m', 'm', 0.42)).toEqual({ ok: true, value: 0.42 });
  });

  it('leaves temperature in degrees Celsius', () => {
    expect(convertToCanonical('degC', 'degC', -7.3)).toEqual({ ok: true, value: -7.3 });
  });
});

describe('convertToCanonical', () => {
  it('carries absence across as absence, never as zero', () => {
    expect(convertToCanonical('km/h', 'm/s', null)).toEqual({ ok: true, value: null });
  });

  it('rejects a unit the source did not promise, naming both units', () => {
    const result = convertToCanonical('degF', 'degC', 72);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SCHEMA_MISMATCH');
      expect(result.error.context).toEqual({ expected: 'degC', received: 'degF' });
    }
  });

  it('returns the rejection rather than throwing it', () => {
    expect(() => convertToCanonical('degF', 'degC', 72)).not.toThrow();
  });
});
