import { describe, expect, it } from 'vitest';

import { parsePlaceLookupResponse } from '../../ports/place-lookup.port';
import { readFixtureBody, readManifest } from '../mock/fixture-files';
import { openMeteoResponseSchema, parseOpenMeteoBody } from './open-meteo.schema';

function fixture(name: string): unknown {
  return JSON.parse(readFixtureBody(name));
}

describe('the Open-Meteo envelope schema', () => {
  it('parses a recorded forecast response', () => {
    const parsed = openMeteoResponseSchema.safeParse(fixture('lisbon-surf.json'));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.hourly?.time).toHaveLength(168);
    expect(parsed.data?.latitude).toBeCloseTo(38.75, 2);
  });

  it('rejects a response whose units are not the ones we asked for', () => {
    const corrupted = structuredClone(fixture('lisbon-surf.json')) as {
      hourly_units: Record<string, string>;
    };
    corrupted.hourly_units.temperature_2m = '°F';

    const parsed = openMeteoResponseSchema.safeParse(corrupted);

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('temperature_2m');
  });

  it('accepts "undefined" as the unit of a variable the model does not carry', () => {
    // ERA5 has no visibility and no freezing_level_height: the unit reads
    // "undefined" and every slot is null (stage-three.md, section 6).
    const parsed = openMeteoResponseSchema.safeParse(fixture('chamonix-winter-ski.json'));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.hourly_units?.visibility).toBe('undefined');
  });

  it('refuses "undefined" as a unit when the series actually carries values', () => {
    const corrupted = structuredClone(fixture('lisbon-surf.json')) as {
      hourly_units: Record<string, string>;
    };
    corrupted.hourly_units.visibility = 'undefined';

    expect(openMeteoResponseSchema.safeParse(corrupted).success).toBe(false);
  });

  it('parses null inside an hourly array but not a missing array', () => {
    const withNulls = structuredClone(fixture('lisbon-surf.json')) as {
      hourly: Record<string, unknown>;
    };
    (withNulls.hourly.temperature_2m as (number | null)[])[3] = null;

    expect(openMeteoResponseSchema.safeParse(withNulls).success).toBe(true);

    const missing = structuredClone(fixture('lisbon-surf.json')) as {
      hourly: Record<string, unknown>;
    };
    delete missing.hourly.temperature_2m;

    const parsed = openMeteoResponseSchema.safeParse(missing);

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('temperature_2m');
  });

  it('refuses a series whose length does not match its own time axis', () => {
    const short = structuredClone(fixture('lisbon-surf.json')) as {
      hourly: Record<string, unknown>;
    };
    short.hourly.temperature_2m = (short.hourly.temperature_2m as number[]).slice(0, 10);

    expect(openMeteoResponseSchema.safeParse(short).success).toBe(false);
  });

  it('parses a marine response that has no daily block at all', () => {
    const parsed = openMeteoResponseSchema.safeParse(fixture('marine-prague-inland.json'));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.daily).toBeUndefined();
    expect(parsed.data?.hourly?.wave_height?.every((value) => value === null)).toBe(true);
  });

  it('reports a malformed body rather than throwing', () => {
    const result = parseOpenMeteoBody('');

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('MALFORMED_BODY');
  });

  it('reports a body that parses but is not an Open-Meteo envelope', () => {
    const result = parseOpenMeteoBody('{"error":true,"reason":"Latitude must be in range"}');

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('SCHEMA_MISMATCH');
  });

  it('never repeats the source reason in the error it returns', () => {
    const result = parseOpenMeteoBody('{"error":true,"reason":"Latitude must be in range"}');

    expect(JSON.stringify(result)).not.toContain('Latitude must be in range');
  });

  it('parses every recorded fixture the manifest lists as a series recording', () => {
    const series = readManifest().fixtures.filter(
      (entry) => entry.endpoint !== 'lookup' && entry.status === 200 && entry.bytes > 0,
    );

    expect(series.length).toBeGreaterThan(0);

    for (const entry of series) {
      const parsed = openMeteoResponseSchema.safeParse(JSON.parse(readFixtureBody(entry.file)));

      expect(parsed.success, `${entry.name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('reads a geocoding miss as an empty result rather than a failure', () => {
    // The body is `{"generationtime_ms": 0.6}` with no `results` key at all:
    // the contract's lookup schema makes it optional for exactly this reason
    // (stage-three.md, section 6).
    const body = JSON.parse(readFixtureBody('geocoding-not-found.json')) as Record<string, unknown>;

    expect(body).not.toHaveProperty('results');

    const result = parsePlaceLookupResponse(body);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : undefined).toEqual([]);
  });

  it('reads a recorded lookup hit through the same schema', () => {
    const result = parsePlaceLookupResponse(JSON.parse(readFixtureBody('geocoding-lisbon.json')));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value[0]?.name : undefined).toBe('Lisbon');
  });
});
