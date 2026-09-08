import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Capability, MetricCode } from '../../../../domain/weather/metric';
import type { Coordinates, SeriesRequest } from '../../ports/contracts';
import { runSeriesPortContract } from '../../contract/weather-port.conformance';
import { OPEN_METEO_CAPABILITIES } from './capabilities';
import { OpenMeteoSeriesSource } from './open-meteo.source';

/**
 * The live source, admitted by the suite that admits the recorded one.
 *
 * The suite is not touched, not relaxed and not specialised: the whole value
 * of having one is that "interchangeable" is a checked property rather than an
 * intention (spec `open-meteo-source`, "The live source is admitted by the
 * same contract as any other"). What stands in for the live API is a local
 * server replaying recorded bodies — the adapter travels its entire real path,
 * transport included.
 */
const FIXTURES = join(process.cwd(), 'src/modules/weather/adapters/mock/fixtures');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** Cases are addressed by latitude, the way the recorded source is. */
const LISBON: Coordinates = { latitude: 38.72, longitude: -9.15 };
const PRAGUE: Coordinates = { latitude: 50.08, longitude: 14.44 };
const EMPTY_BODY: Coordinates = { latitude: 0.1, longitude: 0 };
const HTML_403: Coordinates = { latitude: 0.2, longitude: 0 };
const JSON_400: Coordinates = { latitude: 0.3, longitude: 0 };
const TIMES_OUT: Coordinates = { latitude: 0.4, longitude: 0 };

const SOURCE_REASON =
  'Cannot initialize WeatherVariable from invalid String value "temperature_2meters"';

const ANSWERED_GRID = { latitude: 38.75, longitude: -9.125, elevationMetres: 48 };
const MARINE_GRID = { latitude: 50.125008, longitude: 14.4583435, elevationMetres: 199 };

let server: Server;
let origin: string;
const log: string[] = [];

beforeAll(async () => {
  server = createServer((incoming, response) => {
    const latitude = new URL(incoming.url ?? '', 'http://x').searchParams.get('latitude');

    if (latitude === String(EMPTY_BODY.latitude)) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end();
      return;
    }

    if (latitude === String(HTML_403.latitude)) {
      response.writeHead(403, { 'content-type': 'text/html' });
      response.end('<html><head><title>403 Forbidden</title></head></html>');
      return;
    }

    if (latitude === String(JSON_400.latitude)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: true, reason: SOURCE_REASON }));
      return;
    }

    if (latitude === String(TIMES_OUT.latitude)) {
      // Accepted, then silence.
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      latitude === String(PRAGUE.latitude)
        ? fixture('marine-prague-inland.json')
        : fixture('lisbon-surf.json'),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
});

const sources: OpenMeteoSeriesSource<Capability>[] = [];

function liveSource(capability: Capability) {
  const source = new OpenMeteoSeriesSource(
    { ...OPEN_METEO_CAPABILITIES[capability], origin },
    { log: (line) => log.push(line), headersTimeoutMs: 250 },
  ) as OpenMeteoSeriesSource<Capability>;
  sources.push(source);

  return source;
}

afterAll(async () => {
  await Promise.all(sources.splice(0).map((source) => source.close()));
});

function request(
  capability: Capability,
  location: Coordinates,
  metrics: readonly MetricCode[],
): SeriesRequest {
  return {
    capability,
    location,
    metrics,
    horizon: { kind: 'forecast', forecastDays: 7 },
    timezone: 'auto',
  };
}

describe('the live Open-Meteo source', () => {
  it('reports no violations of the shared source contract', async () => {
    const report = await runSeriesPortContract({
      createPort: () => liveSource('forecast'),
      unsupportedMetric: 'wave_height',
      readSourceLog: () => log,
      series: [
        {
          name: 'a Lisbon forecast',
          request: request('forecast', LISBON, [
            'temperature_2m',
            'wind_speed_10m',
            'visibility',
          ]),
          expectHourly: {
            temperature_2m: [20.7, 20.4, 20.2, 19.8],
            // 12.8 km/h is 3.555… m/s: what crosses the port is canonical.
            wind_speed_10m: [12.8 / 3.6, 10.3 / 3.6, 10.2 / 3.6, 10.6 / 3.6],
            // Metres in, kilometres out.
            visibility: [20.64, 17.9, 19.9, 21],
          },
          expectGridPoint: ANSWERED_GRID,
        },
      ],
      failures: [
        {
          name: 'an empty 200 body',
          request: request('forecast', EMPTY_BODY, ['temperature_2m']),
          expectCode: 'MALFORMED_BODY',
        },
        {
          name: 'an HTML 403',
          request: request('forecast', HTML_403, ['temperature_2m']),
          expectCode: 'UNEXPECTED_CONTENT_TYPE',
        },
        {
          name: 'a JSON 400 carrying the source reason',
          request: request('forecast', JSON_400, ['temperature_2m']),
          expectCode: 'UNEXPECTED_STATUS',
          sourceText: SOURCE_REASON,
        },
        {
          name: 'a source that never answers',
          request: request('forecast', TIMES_OUT, ['temperature_2m']),
          expectCode: 'TIMEOUT',
        },
      ],
    });

    expect(report.violations).toEqual([]);
  });

  it('reports no violations when it serves the marine capability', async () => {
    const report = await runSeriesPortContract({
      createPort: () => liveSource('marine'),
      unsupportedMetric: 'temperature_2m',
      readSourceLog: () => log,
      series: [
        {
          name: 'marine over land',
          request: request('marine', PRAGUE, ['wave_height']),
          expectAllAbsent: ['wave_height'],
          expectGridPoint: MARINE_GRID,
        },
      ],
      failures: [
        {
          name: 'an HTML 403',
          request: request('marine', HTML_403, ['wave_height']),
          expectCode: 'UNEXPECTED_CONTENT_TYPE',
        },
      ],
    });

    expect(report.violations).toEqual([]);
  });

  it('reports no violations when it serves the archive capability', async () => {
    const report = await runSeriesPortContract({
      createPort: () => liveSource('archive'),
      unsupportedMetric: 'wave_height',
      readSourceLog: () => log,
      series: [
        {
          name: 'an archive window',
          request: {
            ...request('archive', LISBON, ['temperature_2m']),
            horizon: { kind: 'window', startDate: '2025-01-08', endDate: '2025-01-14' },
          },
          expectHourly: { temperature_2m: [20.7, 20.4, 20.2, 19.8] },
          expectGridPoint: ANSWERED_GRID,
        },
      ],
      failures: [
        {
          name: 'an empty 200 body',
          request: {
            ...request('archive', EMPTY_BODY, ['temperature_2m']),
            horizon: { kind: 'window', startDate: '2025-01-08', endDate: '2025-01-14' },
          },
          expectCode: 'MALFORMED_BODY',
        },
      ],
    });

    expect(report.violations).toEqual([]);
  });
});
