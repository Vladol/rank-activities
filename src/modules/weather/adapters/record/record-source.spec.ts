import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { valuesOf } from '../../../../domain/weather/weather-series';
import type { SeriesRequest } from '../../ports/contracts';
import { OPEN_METEO_CAPABILITIES } from '../open-meteo/capabilities';
import { OpenMeteoSeriesSource } from '../open-meteo/open-meteo.source';
import { type FixtureManifest, MANIFEST_FILE } from '../mock/fixture-manifest';
import { FixtureWriter } from './fixture-writer';
import { recordingSeriesSource } from './record-sources';

const FIXTURES = join(process.cwd(), 'src/modules/weather/adapters/mock/fixtures');

let directory: string;
let server: Server;
let origin: string;
const closing: { close: () => Promise<void> }[] = [];

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'record-'));
  writeFileSync(
    join(directory, MANIFEST_FILE),
    JSON.stringify({ recordedWith: 'test', fixtures: [], gaps: [] }),
    'utf8',
  );

  const body = readFileSync(join(FIXTURES, 'lisbon-surf.json'), 'utf8');
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await Promise.all(closing.splice(0).map((source) => source.close()));
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
});

const LISBON: SeriesRequest = {
  capability: 'forecast',
  location: { latitude: 38.72, longitude: -9.15 },
  metrics: ['temperature_2m'],
  horizon: { kind: 'forecast', forecastDays: 7 },
  timezone: 'auto',
};

function manifest(): FixtureManifest {
  return JSON.parse(readFileSync(join(directory, MANIFEST_FILE), 'utf8')) as FixtureManifest;
}

/**
 * The recording host is the local server, so the recorded URL carries a
 * loopback hostname the writer would refuse. The writer is given the real host
 * to file it under, which is what a real recording run would produce anyway.
 */
function writerFor(): FixtureWriter {
  return new FixtureWriter({ directory });
}

describe('recording is a by-product of serving', () => {
  it('returns what the live source alone would have returned', async () => {
    const live = new OpenMeteoSeriesSource({ ...OPEN_METEO_CAPABILITIES.forecast, origin });
    const recording = recordingSeriesSource('forecast', {
      origin,
      writer: writerFor(),
      rewriteUrl: (url) => url.replace(origin, 'https://api.open-meteo.com'),
    });
    closing.push(live, recording);

    const served = await live.fetch(LISBON);
    const recorded = await recording.fetch(LISBON);

    expect(recorded.ok).toBe(true);
    expect(served.ok).toBe(true);

    if (!recorded.ok || !served.ok) {
      return;
    }

    expect(valuesOf(recorded.value.hourly, 'temperature_2m')).toEqual(
      valuesOf(served.value.hourly, 'temperature_2m'),
    );
  });

  it('writes the raw body, its request URL and the moment of recording', async () => {
    const recording = recordingSeriesSource('forecast', {
      origin,
      writer: writerFor(),
      rewriteUrl: (url) => url.replace(origin, 'https://api.open-meteo.com'),
    });
    closing.push(recording);

    await recording.fetch(LISBON);

    const entry = manifest().fixtures[0];

    expect(entry?.url).toContain('https://api.open-meteo.com/v1/forecast');
    expect(entry?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry?.location).toEqual({ latitude: 38.72, longitude: -9.15 });
    expect(readFileSync(join(directory, entry?.file ?? ''), 'utf8')).toBe(
      readFileSync(join(FIXTURES, 'lisbon-surf.json'), 'utf8'),
    );
  });

  it('still answers the caller when the fixture cannot be written', async () => {
    const recording = recordingSeriesSource('forecast', {
      origin,
      writer: writerFor(),
      rewriteUrl: (url) => url.replace(origin, 'https://api.open-meteo.com'),
    });
    closing.push(recording);

    await recording.fetch(LISBON);
    // The second recording is refused: the fixture already exists.
    const second = await recording.fetch(LISBON);

    // Recording is a side effect. A refusal to overwrite must not become a
    // failed request for whoever was actually asking.
    expect(second.ok).toBe(true);
    expect(readdirSync(directory)).toHaveLength(2);
  });

  it('reports the refusal, naming the fixture', async () => {
    const lines: string[] = [];
    const recording = recordingSeriesSource('forecast', {
      origin,
      writer: writerFor(),
      rewriteUrl: (url) => url.replace(origin, 'https://api.open-meteo.com'),
      log: (line) => lines.push(line),
    });
    closing.push(recording);

    await recording.fetch(LISBON);
    await recording.fetch(LISBON);

    expect(lines.join('\n')).toContain('recorded-forecast-38.72--9.15');
  });
});
