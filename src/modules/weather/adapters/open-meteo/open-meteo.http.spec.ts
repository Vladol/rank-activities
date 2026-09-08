import { gzipSync } from 'node:zlib';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { OpenMeteoHttp, isRateLimited } from './open-meteo.http';
import { parseJsonBody } from './open-meteo.schema';

/**
 * The transport is tested against a real local server rather than a stubbed
 * dispatcher: every failure it has to classify — an HTML error page, an empty
 * body, a limit response, a host that never answers — is a property of the
 * wire, and a fake dispatcher would only prove that the fake behaves as
 * written (stage-three.md, section 6).
 */
type Handler = (request: IncomingMessage, response: ServerResponse) => void;

interface TestServer {
  readonly origin: string;
  readonly connections: () => number;
  readonly requests: () => readonly IncomingMessage[];
}

const running: Server[] = [];
const clients: OpenMeteoHttp[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((transport) => transport.close()));

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

async function serve(handler: Handler): Promise<TestServer> {
  let connections = 0;
  const requests: IncomingMessage[] = [];

  const server = createServer((request, response) => {
    requests.push(request);
    handler(request, response);
  });

  server.on('connection', () => {
    connections += 1;
  });

  running.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    connections: () => connections,
    requests: () => requests,
  };
}

function client(options: ConstructorParameters<typeof OpenMeteoHttp>[0] = {}): OpenMeteoHttp {
  const transport = new OpenMeteoHttp(options);
  clients.push(transport);

  return transport;
}

/** Headers, then silence: reading the body of one of these would hang. */
const limitedWithoutBody =
  (headers: Record<string, string>): Handler =>
  (_request, response) => {
    response.writeHead(429, { 'content-type': 'application/json', ...headers });
    response.flushHeaders();
  };

const HTML_403 =
  '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n</body>\r\n</html>';

describe('the transport classifies a response before it parses it', () => {
  it('types an HTML error page by its content type, without reading it as JSON', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(403, { 'content-type': 'text/html' });
      response.end(HTML_403);
    });

    const result = await client().get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    // MALFORMED_BODY here would mean the body reached `JSON.parse` first.
    expect(result.error.code).toBe('UNEXPECTED_CONTENT_TYPE');
  });

  it('keeps the vendor page out of the returned failure', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(403, { 'content-type': 'text/html' });
      response.end(HTML_403);
    });

    const result = await client().get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('403 Forbidden');
  });

  it('logs what the vendor page said, so the fault stays explainable', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(403, { 'content-type': 'text/html' });
      response.end(HTML_403);
    });

    const lines: string[] = [];
    await client({ log: (line) => lines.push(line) }).get(`${server.origin}/v1/forecast`);

    expect(lines.join('\n')).toContain('text/html');
  });
});

describe('the transport refuses an empty body before parsing it', () => {
  it('types a zero-byte 200 as an empty body', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end();
    });

    const result = await client().get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('MALFORMED_BODY');
    expect(result.error.context?.bytes).toBe(0);
  });

  it('says something different about an empty body than about an unparseable one', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end();
    });

    const empty = await client().get(`${server.origin}/v1/forecast`);
    const truncated = parseJsonBody('{"latitude": 38.7');

    expect(empty.ok).toBe(false);
    expect(truncated.ok).toBe(false);

    if (empty.ok || truncated.ok) {
      return;
    }

    // Both are MALFORMED_BODY — the contract has one code for a body that does
    // not parse. An operator still has to be able to tell "nothing arrived"
    // from "something arrived and was broken".
    expect(empty.error.message).not.toBe(truncated.error.message);
    expect(empty.error.context?.bytes).not.toBe(truncated.error.context?.bytes);
  });
});

describe('the transport recognises a limit response from its status alone', () => {
  it('types a limited response without waiting for its body', async () => {
    const server = await serve(limitedWithoutBody({}));

    const started = Date.now();
    const result = await client({ bodyTimeoutMs: 30_000 }).get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(isRateLimited(result.error)).toBe(true);
    // A transport that read the body would still be waiting on the 30 s bound.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('carries the delay the source stated', async () => {
    const server = await serve(limitedWithoutBody({ 'retry-after': '37' }));

    const result = await client({ bodyTimeoutMs: 30_000 }).get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.context?.retryAfterSeconds).toBe(37);
  });

  it('reports the same failure without a delay when the source states none', async () => {
    const server = await serve(limitedWithoutBody({}));

    const result = await client({ bodyTimeoutMs: 30_000 }).get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(isRateLimited(result.error)).toBe(true);
    expect(result.error.context?.retryAfterSeconds).toBeUndefined();
  });
});

describe('the transport bounds one attempt', () => {
  it('fails within the configured bound when a host accepts and never answers', async () => {
    // Accepted, then silence: no status line, no headers, no body.
    const server = await serve(() => undefined);

    const started = Date.now();
    const result = await client({ headersTimeoutMs: 200 }).get(`${server.origin}/v1/forecast`);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('TIMEOUT');
    // The measurement stage-six.md, section 9.2 asks for: the bound we set,
    // not the system default.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('reports a connection that was never established as a transport failure', async () => {
    const server = await serve((_request, response) => response.end('{}'));
    // A port that was listening a moment ago and is not any more: the
    // connection is refused rather than left hanging.
    const origin = server.origin;
    await new Promise<void>((resolve) => {
      running.pop()?.close(() => resolve());
    });

    const result = await client().get(`${origin}/v1/forecast`);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('TRANSPORT_FAILURE');
  });
});

describe('the transport is configured for the traffic this service makes', () => {
  it('does not open a connection per call to the same host', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"latitude":38.75}');
    });

    const transport = client();

    for (const capability of ['forecast', 'marine', 'archive', 'forecast', 'marine', 'archive']) {
      await transport.get(`${server.origin}/v1/${capability}`);
    }

    expect(server.requests()).toHaveLength(6);
    // 27 ms of the observed 136 ms is TCP setup (stage-three.md, section 7.1),
    // and this is the whole of the saving: the pool warms up with a second
    // socket because undici returns a finished one on a later tick, and then
    // reuses. Six calls over two sockets, not six.
    expect(server.connections()).toBeLessThanOrEqual(2);
  });

  it('receives a compressed body and hands on the decoded one', async () => {
    const payload = JSON.stringify({
      latitude: 38.75,
      hourly: { time: Array.from({ length: 400 }, (_, index) => `2026-09-07T${index}:00`) },
    });
    let transferred = 0;
    let accepted: string | undefined;

    const server = await serve((request, response) => {
      accepted = String(request.headers['accept-encoding'] ?? '');
      const compressed = gzipSync(payload);
      transferred = compressed.byteLength;
      response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      response.end(compressed);
    });

    const result = await client().get(`${server.origin}/v1/forecast`);

    expect(accepted).toContain('gzip');
    // Compression in effect, not merely requested: the payload really did
    // travel smaller than what the schema is about to read.
    expect(transferred).toBeLessThan(payload.length);
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.body).toBe(payload);
  });
});

describe('the transport types a structured API error by our own code set', () => {
  const REASON = 'Latitude must be in range of -90 to 90°. Given: 999.0.';

  const refuses: Handler = (_request, response) => {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: true, reason: REASON }));
  };

  it('reports an unexpected status, with the status in the context', async () => {
    const server = await serve(refuses);

    const result = await client().get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('UNEXPECTED_STATUS');
    expect(result.error.context?.status).toBe(400);
  });

  it('never returns the source own explanation', async () => {
    const server = await serve(refuses);

    const result = await client().get(`${server.origin}/v1/forecast`);

    // One recorded `reason` named an internal Swift type and one was factually
    // wrong (stage-three.md, section 6). Neither is ours to repeat.
    expect(JSON.stringify(result)).not.toContain(REASON);
  });

  it('logs the source own explanation, so the fault stays explainable', async () => {
    const server = await serve(refuses);

    const lines: string[] = [];
    await client({ log: (line) => lines.push(line) }).get(`${server.origin}/v1/forecast`);

    expect(lines.join('\n')).toContain(REASON);
  });

  it('does not type a refusal as a rate limit', async () => {
    const server = await serve(refuses);

    const result = await client().get(`${server.origin}/v1/forecast`);

    expect(result.ok).toBe(false);
    expect(result.ok || isRateLimited(result.error)).toBe(false);
  });
});
