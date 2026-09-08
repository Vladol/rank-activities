import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { OpenMeteoPlaceLookup } from './lookup';

const FIXTURES = join(process.cwd(), 'src/modules/weather/adapters/mock/fixtures');

const running: Server[] = [];
const sources: OpenMeteoPlaceLookup[] = [];
const asked: IncomingMessage[] = [];

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

async function serving(fixture: string, status = 200): Promise<OpenMeteoPlaceLookup> {
  const body = readFileSync(join(FIXTURES, fixture), 'utf8');
  const server = createServer((request, response) => {
    asked.push(request);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(body);
  });
  running.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const source = new OpenMeteoPlaceLookup({
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
  sources.push(source);

  return source;
}

describe('the live place lookup', () => {
  it('returns every candidate the host offered', async () => {
    const source = await serving('geocoding-moscow-ambiguous.json');

    const result = await source.lookup({ name: 'Moscow' });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    // Ranking is `location-applicability`'s decision, not the adapter's.
    expect(result.value).toHaveLength(10);
  });

  it('reads a miss as an empty result rather than a failure', async () => {
    const source = await serving('geocoding-not-found.json');

    const result = await source.lookup({ name: 'Xyzzy' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual([]);
  });

  it('asks the host by the name it was given', async () => {
    asked.length = 0;
    const source = await serving('geocoding-lisbon.json');

    await source.lookup({ name: 'Lisbon', count: 3 });

    expect(asked.at(-1)?.url).toContain('name=Lisbon');
    expect(asked.at(-1)?.url).toContain('count=3');
  });

  it('reports a refusal as a typed failure, never as an exception', async () => {
    const source = await serving('error-bad-latitude.json', 400);

    const result = await source.lookup({ name: 'Lisbon' });

    expect(result.ok).toBe(false);
    expect(result.ok || result.error.code).toBe('UNEXPECTED_STATUS');
  });
});
