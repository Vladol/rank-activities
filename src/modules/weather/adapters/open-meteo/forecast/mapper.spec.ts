import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { valuesOf } from '../../../../../domain/weather/weather-series';
import { validateOpenMeteoEnvelope } from '../open-meteo.schema';
import { mapForecastResponse } from './mapper';

const SAMPLES = join(process.cwd(), 'docs/investigation/open-meteo/samples');

const CONTEXT = { sourceId: 'open-meteo-forecast', fetchedAt: '2026-09-08T09:00:00Z' };

function mapped(name: string, edit: (body: Record<string, unknown>) => void = () => undefined) {
  const body = JSON.parse(readFileSync(join(SAMPLES, `${name}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
  edit(body);

  const envelope = validateOpenMeteoEnvelope(body);

  if (!envelope.ok) {
    throw new Error(`the sample no longer matches the envelope: ${envelope.error.message}`);
  }

  const series = mapForecastResponse(envelope.value, CONTEXT);

  if (!series.ok) {
    throw new Error(`the sample did not map: ${series.error.message}`);
  }

  return series.value;
}

describe('a hole in a series survives mapping', () => {
  it('keeps a variable the model does not carry present and entirely empty', () => {
    const series = mapped('archive-chamonix-hourly-jan');

    // ERA5 answers "undefined" for visibility with 168 nulls. Dropping it
    // would read downstream as "we never asked", which is a different fact.
    expect(valuesOf(series.hourly, 'visibility')).toHaveLength(168);
    expect(valuesOf(series.hourly, 'visibility')?.every((slot) => slot === null)).toBe(true);
  });

  it('keeps a hole at the position the source left it', () => {
    const series = mapped('archive-chamonix-hourly-jan', (body) => {
      const hourly = body.hourly as Record<string, (number | null)[]>;
      const temperature = hourly.temperature_2m as (number | null)[];
      temperature[3] = null;
      temperature[100] = null;
    });

    const temperature = valuesOf(series.hourly, 'temperature_2m');

    expect(temperature).toHaveLength(168);
    expect(temperature?.[3]).toBeNull();
    expect(temperature?.[100]).toBeNull();
    // A hole is not a zero, and it does not shift its neighbours.
    expect(temperature?.[2]).not.toBeNull();
    expect(temperature?.[4]).not.toBeNull();
  });
});

describe('what crosses the port is in canonical units', () => {
  it('converts wind from km/h to m/s and visibility from m to km', () => {
    const raw = JSON.parse(
      readFileSync(join(SAMPLES, 'archive-chamonix-hourly-jan.json'), 'utf8'),
    ) as { hourly: Record<string, (number | null)[]>; hourly_units: Record<string, string> };
    const series = mapped('archive-chamonix-hourly-jan');

    expect(raw.hourly_units.wind_speed_10m).toBe('km/h');
    expect(valuesOf(series.hourly, 'wind_speed_10m')?.[0]).toBeCloseTo(
      (raw.hourly.wind_speed_10m?.[0] ?? 0) / 3.6,
      9,
    );
  });

  it('leaves snowfall in centimetres beside snow depth in metres', () => {
    const raw = JSON.parse(
      readFileSync(join(SAMPLES, 'archive-chamonix-hourly-jan.json'), 'utf8'),
    ) as { hourly: Record<string, (number | null)[]> };
    const series = mapped('archive-chamonix-hourly-jan');

    // The 100x trap: the two are the same quantity in different units, and the
    // dictionary keeps them that way on purpose (stage-three.md, section 2.4).
    // Slot 5 rather than a quiet hour: 0 cm and 0 m are the same number, and
    // an assertion that holds for either unit proves nothing.
    expect(raw.hourly.snowfall?.[5]).toBe(0.56);
    expect(valuesOf(series.hourly, 'snowfall')?.[5]).toBe(0.56);
    expect(valuesOf(series.hourly, 'snow_depth')?.[24]).toBe(1.57);
  });
});

describe('provenance comes from the answer', () => {
  it('carries the grid point the response reported, elevation included', () => {
    const series = mapped('forecast-chamonix-elev2500');

    // The request named the valley; the model answered for a node at 2500 m,
    // and that node is the only honest provenance (stage-three.md, section 2).
    expect(series.provenance[0]?.gridPoint).toEqual({
      latitude: 45.9,
      longitude: 6.86,
      elevationMetres: 2500,
    });
  });

  it('records the capability it was served by and the moment it arrived', () => {
    const series = mapped('forecast-chamonix-elev2500');

    expect(series.provenance[0]?.capability).toBe('forecast');
    expect(series.provenance[0]?.fetchedAt).toBe(CONTEXT.fetchedAt);
  });
});
