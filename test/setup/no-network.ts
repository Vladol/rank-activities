import { Socket } from 'node:net';

/**
 * Fails any test that opens a connection to anything but this machine.
 *
 * The recorded sources exist so that the suite is deterministic and reachable
 * offline (spec `weather-mock-data`, "The mock never reaches the network"). A
 * fixture that quietly fell back to a live call would still be green, and
 * still be worthless — so the guard is the assertion, not the intention.
 *
 * Loopback stays open: the e2e suite talks to its own server over it.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::', '']);

function isLoopback(host: unknown): boolean {
  return typeof host !== 'string' || LOOPBACK.has(host) || host.startsWith('127.');
}

function refuse(target: string): never {
  throw new Error(
    `A test tried to reach ${target}. The suite runs on recorded fixtures and must not ` +
      'touch the network: record what you need with scripts/record-fixture.ts instead.',
  );
}

function hostOf(args: readonly unknown[]): string {
  const [first] = args;

  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: unknown; hostname?: unknown; path?: unknown };

    // A unix socket has a path and no host; it is not the network.
    if (typeof options.path === 'string' && options.host === undefined) {
      return 'localhost';
    }

    return String(options.hostname ?? options.host ?? 'localhost');
  }

  // connect(port, host?) — a port with no host is loopback.
  const second = args[1];

  return typeof second === 'string' ? second : 'localhost';
}

const originalConnect = Socket.prototype.connect;

// Everything that opens a socket goes through here, `fetch` and undici
// included, so one guard covers the client libraries we have not chosen yet.
Socket.prototype.connect = function guardedConnect(this: Socket, ...args: unknown[]) {
  const host = hostOf(args);

  if (!isLoopback(host)) {
    refuse(host);
  }

  return (originalConnect as (...rest: unknown[]) => Socket).apply(this, args);
};

const originalFetch = globalThis.fetch;

// Guarded separately so the failure names the URL rather than the host.
type FetchTarget = Parameters<typeof fetch>[0];

globalThis.fetch = function guardedFetch(input: FetchTarget, init?: RequestInit) {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (!isLoopback(new URL(url, 'http://localhost').hostname)) {
    refuse(url);
  }

  return originalFetch(input, init);
} as typeof fetch;
