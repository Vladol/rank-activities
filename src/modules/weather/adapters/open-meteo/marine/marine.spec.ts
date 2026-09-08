import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasMetric, valuesOf } from '../../../../../domain/weather/weather-series';
import { mapMarineResponse } from './mapper';
import { parseMarineResponse } from './schema';
import { marineVariables } from './variables';

const SAMPLES = join(process.cwd(), 'docs/investigation/open-meteo/samples');

function sample(name: string): string {
  return readFileSync(join(SAMPLES, `${name}.json`), 'utf8');
}

function asked(...metrics: Parameters<typeof marineVariables>[0]) {
  const variables = marineVariables(metrics);

  if (!variables.ok) {
    throw new Error(variables.error.message);
  }

  return { hourly: variables.value.hourly, daily: [] };
}

describe('the marine triple', () => {
  it('names the vendor variable for a wave metric', () => {
    expect(asked('wave_height').hourly).toEqual(['wave_height']);
  });

  it('refuses a metric the forecast host serves', () => {
    const variables = marineVariables(['temperature_2m']);

    expect(variables.ok).toBe(false);
  });

  it('maps an inland response to a present series of nulls', () => {
    const parsed = parseMarineResponse(sample('marine-prague-inland'), asked('wave_height'));

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const series = mapMarineResponse(parsed.value, {
      sourceId: 'open-meteo-marine',
      fetchedAt: '2026-09-08T09:00:00Z',
    });

    expect(series.ok).toBe(true);

    if (!series.ok) {
      return;
    }

    // Prague has no waves, and the marine host says so with 72 nulls rather
    // than with an error. "We asked and there is nothing" is not "we failed",
    // and it is not an empty series either — `location-applicability` reads
    // the difference.
    expect(hasMetric(series.value.hourly, 'wave_height')).toBe(true);
    expect(valuesOf(series.value.hourly, 'wave_height')).toHaveLength(72);
    expect(valuesOf(series.value.hourly, 'wave_height')?.every((slot) => slot === null)).toBe(true);
  });

  it('records the marine capability in the provenance', () => {
    const parsed = parseMarineResponse(sample('marine-lisbon'), asked('wave_height'));

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const series = mapMarineResponse(parsed.value, {
      sourceId: 'open-meteo-marine',
      fetchedAt: '2026-09-08T09:00:00Z',
    });

    expect(series.ok && series.value.provenance[0]?.capability).toBe('marine');
  });
});
