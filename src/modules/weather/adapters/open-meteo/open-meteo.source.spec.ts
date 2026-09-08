import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { valuesOf } from '../../../../domain/weather/weather-series';
import type { SeriesRequest } from '../../ports/contracts';
import { FORECAST_CAPABILITY, MARINE_CAPABILITY } from './capabilities';
import { OpenMeteoSeriesSource } from './open-meteo.source';

const SAMPLES = join(process.cwd(), 'docs/investigation/open-meteo/samples');

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const running: Server[] = [];
const sources: OpenMeteoSeriesSource<'forecast' | 'marine'>[] = [];

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.close()));
  await Promise.all(
    running.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

const asked: IncomingMessage[] = [];

async function serve(handler: Handler): Promise<string> {
  const server = createServer((request, response) => {
    asked.push(request);
    handler(request, response);
  });
  running.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function answers(name: string): Handler {
  const body = readFileSync(join(SAMPLES, `${name}.json`), 'utf8');

  return (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  };
}

function forecastSource(origin: string, log?: (line: string) => void) {
  const source = new OpenMeteoSeriesSource(
    { ...FORECAST_CAPABILITY, origin },
    log === undefined ? {} : { log },
  );
  sources.push(source);

  return source;
}

const LISBON: SeriesRequest = {
  capability: 'forecast',
  location: { latitude: 38.7167, longitude: -9.1333 },
  metrics: ['temperature_2m'],
  horizon: { kind: 'forecast', forecastDays: 7 },
  timezone: 'auto',
};

describe('the live source builds the request the contract describes', () => {
  it('sends no unit parameter of any kind', async () => {
    asked.length = 0;
    const origin = await serve(answers('forecast-minimal-3vars'));

    await forecastSource(origin).fetch({
      ...LISBON,
      metrics: ['temperature_2m', 'precipitation', 'wind_speed_10m'],
    });

    const url = asked.at(-1)?.url ?? '';

    // A requested unit that is ignored or renamed comes back under an
    // unchanged field name; asserting the declared unit is the only check that
    // fails loudly (design.md, Decision 3).
    expect(url).not.toContain('temperature_unit');
    expect(url).not.toContain('wind_speed_unit');
    expect(url).not.toContain('precipitation_unit');
  });

  it('names the location, the horizon and the timezone', async () => {
    asked.length = 0;
    const origin = await serve(answers('forecast-minimal-3vars'));

    await forecastSource(origin).fetch({
      ...LISBON,
      metrics: ['temperature_2m', 'precipitation', 'wind_speed_10m'],
    });

    const url = new URL(asked.at(-1)?.url ?? '', origin);

    expect(url.searchParams.get('latitude')).toBe('38.7167');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    // Omitting the timezone silently returns GMT and shifts a day for anything
    // far from it (stage-three.md, section 2.2), so there is no "unset".
    expect(url.searchParams.get('timezone')).toBe('auto');
  });

  it('asks an explicit window by dates rather than by a day count', async () => {
    asked.length = 0;
    const origin = await serve(answers('forecast-minimal-3vars'));

    await forecastSource(origin).fetch({
      ...LISBON,
      metrics: ['temperature_2m', 'precipitation', 'wind_speed_10m'],
      horizon: { kind: 'window', startDate: '2025-01-08', endDate: '2025-01-14' },
    });

    const url = new URL(asked.at(-1)?.url ?? '', origin);

    expect(url.searchParams.get('start_date')).toBe('2025-01-08');
    expect(url.searchParams.get('end_date')).toBe('2025-01-14');
    expect(url.searchParams.has('forecast_days')).toBe(false);
  });
});

describe('the live source answers with a domain series', () => {
  it('returns the metrics that were asked for, in canonical units', async () => {
    const origin = await serve(answers('forecast-minimal-3vars'));

    const result = await forecastSource(origin).fetch({
      ...LISBON,
      metrics: ['temperature_2m', 'wind_speed_10m'],
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(valuesOf(result.value.hourly, 'temperature_2m')).toBeDefined();
    // km/h in, m/s out.
    expect(valuesOf(result.value.hourly, 'wind_speed_10m')?.[0]).toBeLessThan(20);
  });

  it('carries the grid point the response reported, not the one asked about', async () => {
    const origin = await serve(answers('forecast-minimal-3vars'));

    const result = await forecastSource(origin).fetch(LISBON);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.provenance[0]?.gridPoint.latitude).toBe(38.75);
    expect(result.value.provenance[0]?.gridPoint.latitude).not.toBe(LISBON.location.latitude);
  });

  it('answers marine over land with a present series of holes', async () => {
    const origin = await serve(answers('marine-prague-inland'));
    const source = new OpenMeteoSeriesSource({ ...MARINE_CAPABILITY, origin });
    sources.push(source);

    const result = await source.fetch({
      capability: 'marine',
      location: { latitude: 50.08, longitude: 14.44 },
      metrics: ['wave_height'],
      horizon: { kind: 'forecast', forecastDays: 3 },
      timezone: 'auto',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(valuesOf(result.value.hourly, 'wave_height')?.every((slot) => slot === null)).toBe(true);
  });
});

describe('the live source refuses what it cannot serve', () => {
  it('denies support for a metric another host serves', () => {
    const source = new OpenMeteoSeriesSource({ ...FORECAST_CAPABILITY, origin: 'http://127.0.0.1:1' });
    sources.push(source);

    expect(source.supports('temperature_2m')).toBe(true);
    expect(source.supports('wave_height')).toBe(false);
  });

  it('fails when the response omits a metric that was asked for', async () => {
    const origin = await serve(answers('forecast-minimal-3vars'));

    const result = await forecastSource(origin).fetch({ ...LISBON, metrics: ['snow_depth'] });

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('SCHEMA_MISMATCH');
  });

  it('logs the vendor reason for a refusal and returns none of it', async () => {
    const reason = 'Latitude must be in range of -90 to 90°. Given: 999.0.';
    const origin = await serve((_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: true, reason }));
    });

    const lines: string[] = [];
    const result = await forecastSource(origin, (line) => lines.push(line)).fetch(LISBON);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(reason);
    expect(lines.join('\n')).toContain(reason);
  });
});
