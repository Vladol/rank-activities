import { beforeEach, describe, expect, it } from 'vitest';

import { stubPort, stubSeries } from '../../../../test/support/stub-series-port';
import type { CacheKey } from '../../../common/cache/cache-keys';
import type { CachePort } from '../../../common/cache/cache.port';
import { NullCache } from '../../../common/cache/cache.port';
import type { Lifetime } from '../../../common/cache/freshness';
import { guardCache } from '../../../common/cache/guard-cache';
import { MemoryCache } from '../../../common/cache/memory-cache.adapter';
import { METRIC, MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { domainError } from '../../../domain/shared/domain-error';
import { err, ok } from '../../../domain/shared/result';
import type { Capability, MetricCode } from '../../../domain/weather/metric';
import { daysCovered } from '../../../domain/weather/slice-series';
import type { SeriesRequest } from '../ports/contracts';
import { cacheSeriesPort } from './cached-series.port';

const HOUR = 3_600_000;
const START = Date.parse('2026-03-01T10:15:00Z');

const LIFETIMES: Readonly<Record<Capability, Lifetime>> = {
  forecast: { ttlSeconds: 3_600, maxStaleSeconds: 10_800 },
  marine: { ttlSeconds: 3_600, maxStaleSeconds: 10_800 },
  archive: { ttlSeconds: 86_400, maxStaleSeconds: 604_800 },
};

function request(days = 7, metrics: readonly MetricCode[] = ['temperature_2m']): SeriesRequest {
  return {
    capability: 'forecast',
    location: { latitude: 38.7223, longitude: -9.1393 },
    metrics,
    horizon: { kind: 'forecast', forecastDays: days },
    timezone: 'Europe/Lisbon',
  };
}

function harness(options: { cache?: CachePort; maxForecastDays?: number } = {}) {
  let now = START;
  const revalidations: Promise<void>[] = [];
  const metrics = new MetricsRegistry();
  const inner = stubPort('forecast');
  const cached = cacheSeriesPort(inner, {
    cache: options.cache ?? new MemoryCache({ maxEntries: 100, maxBytes: 1_000_000, now: () => now }),
    lifetimes: LIFETIMES,
    maxForecastDays: options.maxForecastDays ?? 7,
    now: () => now,
    metrics,
    onRevalidate: (settled) => revalidations.push(settled),
  });

  return {
    inner,
    cached,
    metrics,
    revalidations,
    advance: (ms: number): void => {
      now += ms;
    },
    settle: (): Promise<unknown> => Promise.all(revalidations),
  };
}

describe('data already obtained is reused instead of re-requested', () => {
  it('answers a repeated request without an outbound call', async () => {
    const { inner, cached } = harness();

    const first = await cached.fetch(request());
    const second = await cached.fetch(request());

    expect(inner.requests).toHaveLength(1);
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.value.provenance[0]?.fetchedAt).toBe(
      first.ok ? first.value.provenance[0]?.fetchedAt : 'differs',
    );
  });

  it('reports both answers as fresh', async () => {
    const { cached } = harness();

    await cached.fetch(request());
    const second = await cached.fetch(request());

    expect(second.ok && second.value.provenance.every((entry) => entry.stale)).toBe(false);
  });

  it('takes the lifetime from configuration rather than from a constant', async () => {
    // The archive's day-long interval and the forecast's hour are the same code
    // reading two different numbers.
    let now = START;
    const inner = stubPort('archive');
    const cached = cacheSeriesPort(inner, {
      cache: new MemoryCache({ maxEntries: 10, maxBytes: 100_000, now: () => now }),
      lifetimes: LIFETIMES,
      maxForecastDays: 7,
      now: () => now,
    });
    const windowed: SeriesRequest = {
      capability: 'archive',
      location: { latitude: 38.72, longitude: -9.14 },
      metrics: ['temperature_2m'],
      horizon: { kind: 'window', startDate: '2025-01-01', endDate: '2025-01-07' },
      timezone: 'Europe/Lisbon',
    };

    await cached.fetch(windowed);
    now += 3 * HOUR;
    await cached.fetch(windowed);

    // Three hours on: the forecast would have expired, the archive has not.
    expect(inner.requests).toHaveLength(1);
  });

  it('expires on the interval boundary, not an hour after whoever asked first', async () => {
    const early = harness();
    const late = harness();

    await early.cached.fetch(request());
    late.advance(40 * 60_000);
    await late.cached.fetch(request());

    // 10:15 and 10:55 both expire at 11:00.
    early.advance(46 * 60_000);
    late.advance(6 * 60_000);
    await early.cached.fetch(request());
    await late.cached.fetch(request());

    expect(early.metrics.read(METRIC.cacheOperations, {
      source: 'stub-forecast',
      capability: 'forecast',
      outcome: 'stale',
    })).toBe(1);
    expect(late.metrics.read(METRIC.cacheOperations, {
      source: 'stub-forecast',
      capability: 'forecast',
      outcome: 'stale',
    })).toBe(1);
  });
});

describe('the horizon is not part of the question the source is asked', () => {
  it('always asks for the maximum horizon, whatever was requested', async () => {
    const { inner, cached } = harness({ maxForecastDays: 7 });

    await cached.fetch(request(3));

    expect(inner.requests[0]?.horizon).toEqual({ kind: 'forecast', forecastDays: 7 });
  });

  it('serves a short and a long request from one call', async () => {
    const { inner, cached } = harness();

    const short = await cached.fetch(request(3));
    const long = await cached.fetch(request(7));

    expect(inner.requests).toHaveLength(1);
    expect(short.ok && daysCovered(short.value)).toBe(3);
    expect(long.ok && daysCovered(long.value)).toBe(7);
  });

  it('never widens past what the source declares', async () => {
    let now = START;
    const inner = stubPort('forecast', { limits: { maxForecastDays: 5, maxPastDays: 0 } });
    const cached = cacheSeriesPort(inner, {
      cache: new MemoryCache({ maxEntries: 10, maxBytes: 100_000, now: () => now }),
      lifetimes: LIFETIMES,
      maxForecastDays: 16,
      now: () => now,
    });

    await cached.fetch(request(2));

    expect(inner.requests[0]?.horizon).toEqual({ kind: 'forecast', forecastDays: 5 });
  });
});

describe('stale data is an answer, and it says how old it is', () => {
  it('answers from old data when the source has gone away', async () => {
    const { inner, cached, advance } = harness();

    await cached.fetch(request());
    inner.answer = () =>
      Promise.resolve(err(domainError('TRANSPORT_FAILURE', 'the call never completed')));
    advance(HOUR);

    const answer = await cached.fetch(request());

    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.value.provenance[0]?.stale).toBe(true);
    expect(answer.ok && answer.value.provenance[0]?.fetchedAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('does not make the caller wait for the refresh it triggers', async () => {
    const { inner, cached, advance, settle } = harness();

    await cached.fetch(request());
    const gate = deferred<ReturnType<typeof ok<ReturnType<typeof stubSeries>>>>();

    inner.answer = () => gate.promise;
    advance(HOUR);

    // Answered while the refresh is still outstanding.
    const answer = await cached.fetch(request());

    expect(answer.ok && answer.value.provenance[0]?.stale).toBe(true);
    gate.resolve(ok(stubSeries({ capability: 'forecast', days: 7 })));
    await settle();
  });

  it('makes the next answer fresh once the refresh succeeds', async () => {
    const { inner, cached, advance, settle } = harness();

    await cached.fetch(request());
    inner.answer = (given) =>
      Promise.resolve(
        ok(stubSeries({ capability: 'forecast', request: given, fetchedAt: '2026-03-01T11:00:00.000Z' })),
      );
    advance(HOUR);

    await cached.fetch(request());
    await settle();
    const next = await cached.fetch(request());

    expect(next.ok && next.value.provenance[0]?.stale).toBe(false);
    expect(next.ok && next.value.provenance[0]?.fetchedAt).toBe('2026-03-01T11:00:00.000Z');
    expect(inner.requests).toHaveLength(2);
  });

  it('refreshes in the background even when nothing is watching it', async () => {
    // The hook is an observer. Making the refresh depend on it would mean the
    // production wiring, which passes none, never revalidates at all — every
    // answer stale from the same entry until it expired outright.
    let now = START;
    const inner = stubPort('forecast');
    const cached = cacheSeriesPort(inner, {
      cache: new MemoryCache({ maxEntries: 10, maxBytes: 100_000, now: () => now }),
      lifetimes: LIFETIMES,
      maxForecastDays: 7,
      now: () => now,
    });

    await cached.fetch(request());
    now += HOUR;
    await cached.fetch(request());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inner.requests).toHaveLength(2);

    const next = await cached.fetch(request());

    expect(next.ok && next.value.provenance[0]?.stale).toBe(false);
  });

  it('treats data past the staleness limit as absent rather than as old', async () => {
    const { inner, cached, advance } = harness();

    await cached.fetch(request());
    inner.answer = () =>
      Promise.resolve(err(domainError('TRANSPORT_FAILURE', 'the call never completed')));
    advance(4 * HOUR);

    const answer = await cached.fetch(request());

    // Three hours is the configured limit: there is no answer to give, and the
    // failure is the source's own rather than an invented one.
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error.code).toBe('TRANSPORT_FAILURE');
  });
});

describe('simultaneous misses on one key produce one call', () => {
  it('calls once and answers all of them', async () => {
    const { inner, cached } = harness();
    const gate = deferred<ReturnType<typeof ok<ReturnType<typeof stubSeries>>>>();

    inner.answer = () => gate.promise;

    const waiting = [cached.fetch(request()), cached.fetch(request()), cached.fetch(request())];

    await nextTick();
    gate.resolve(ok(stubSeries({ capability: 'forecast', days: 7 })));
    const answers = await Promise.all(waiting);

    expect(inner.requests).toHaveLength(1);
    expect(answers.every((answer) => answer.ok)).toBe(true);
  });

  it('gives every waiter the same failure, and none of them retries', async () => {
    const { inner, cached } = harness();
    const failure = domainError('TIMEOUT', 'the source did not answer within the attempt budget');

    inner.answer = () => Promise.resolve(err(failure));

    const answers = await Promise.all([cached.fetch(request()), cached.fetch(request())]);

    expect(inner.requests).toHaveLength(1);
    expect(answers.every((answer) => !answer.ok && answer.error === failure)).toBe(true);
  });

  it('counts the joins', async () => {
    const { inner, cached, metrics } = harness();
    const gate = deferred<ReturnType<typeof ok<ReturnType<typeof stubSeries>>>>();

    inner.answer = () => gate.promise;

    const waiting = [cached.fetch(request()), cached.fetch(request())];

    await nextTick();
    gate.resolve(ok(stubSeries({ capability: 'forecast', days: 7 })));
    await Promise.all(waiting);

    expect(
      metrics.read(METRIC.singleFlightJoins, { source: 'stub-forecast', capability: 'forecast' }),
    ).toBe(1);
  });
});

describe('a cache that cannot answer is a miss', () => {
  let broken: CachePort;

  beforeEach(() => {
    broken = {
      name: 'broken',
      get: () => Promise.reject(new Error('the cache is unreachable')),
      set: () => Promise.reject(new Error('the cache is unreachable')),
      delete: () => Promise.reject(new Error('the cache is unreachable')),
      clear: () => Promise.reject(new Error('the cache is unreachable')),
    };
  });

  it('answers by calling the source, and fails no request', async () => {
    const { inner, cached } = harness({ cache: guarded(broken) });

    const first = await cached.fetch(request());
    const second = await cached.fetch(request());

    expect(first.ok && second.ok).toBe(true);
    expect(inner.requests).toHaveLength(2);
  });

  it('reads a payload it cannot decode as a miss', async () => {
    let now = START;
    const store = new MemoryCache({ maxEntries: 10, maxBytes: 100_000, now: () => now });
    const inner = stubPort('forecast');
    const cached = cacheSeriesPort(inner, {
      cache: store,
      lifetimes: LIFETIMES,
      maxForecastDays: 7,
      now: () => now,
    });

    await cached.fetch(request());
    const key = [...(store as unknown as { store: Map<string, unknown> }).store.keys()][0];

    await store.set(key as CacheKey, {
      payload: 'not json at all',
      storedAt: now,
      freshUntil: now + HOUR,
      expiresAt: now + HOUR,
    });
    await cached.fetch(request());

    expect(inner.requests).toHaveLength(2);
  });

  it('does not serve an expired record a lax adapter still hands back', async () => {
    // Expiry is on the record, so it is the caller's to enforce; an adapter
    // that evicts loosely — or a shared store with its own idea of a TTL —
    // must not turn into a week-old forecast served as merely stale.
    let now = START;
    const kept = new Map<string, Parameters<CachePort['set']>[1]>();
    const lax: CachePort = {
      name: 'lax',
      get: (key) => Promise.resolve(kept.get(key)),
      set: (key, record) => {
        kept.set(key, record);

        return Promise.resolve();
      },
      delete: (key) => {
        kept.delete(key);

        return Promise.resolve();
      },
      clear: () => {
        kept.clear();

        return Promise.resolve();
      },
    };
    const inner = stubPort('forecast');
    const cached = cacheSeriesPort(inner, {
      cache: lax,
      lifetimes: LIFETIMES,
      maxForecastDays: 7,
      now: () => now,
    });

    await cached.fetch(request());
    inner.answer = () =>
      Promise.resolve(err(domainError('TRANSPORT_FAILURE', 'the call never completed')));
    now += 4 * HOUR;

    const answer = await cached.fetch(request());

    expect(answer.ok).toBe(false);
  });

  it('binds the null adapter to nothing but misses', async () => {
    const { inner, cached } = harness({ cache: new NullCache() });

    await cached.fetch(request());
    await cached.fetch(request());

    expect(inner.requests).toHaveLength(2);
  });
});

describe('what the cache counts', () => {
  it('separates a hit from a miss', async () => {
    const { cached, metrics } = harness();
    const label = { source: 'stub-forecast', capability: 'forecast' };

    await cached.fetch(request());
    await cached.fetch(request());

    expect(metrics.read(METRIC.cacheOperations, { ...label, outcome: 'miss' })).toBe(1);
    expect(metrics.read(METRIC.cacheOperations, { ...label, outcome: 'hit' })).toBe(1);
  });

  it('counts a failing cache as an error rather than hiding it', async () => {
    const metrics = new MetricsRegistry();
    const cache = guarded(
      {
        name: 'broken',
        get: () => Promise.reject(new Error('down')),
        set: () => Promise.reject(new Error('down')),
        delete: () => Promise.reject(new Error('down')),
        clear: () => Promise.reject(new Error('down')),
      },
      metrics,
    );
    const cached = cacheSeriesPort(stubPort('forecast'), {
      cache,
      lifetimes: LIFETIMES,
      maxForecastDays: 7,
      now: () => START,
      metrics,
    });

    await cached.fetch(request());

    expect(
      metrics.read(METRIC.cacheOperations, { outcome: 'error', adapter: 'broken' }),
    ).toBeGreaterThan(0);
  });
});

/** Production wraps every adapter before anything uses it; so does the test. */
function guarded(cache: CachePort, metrics?: MetricsRegistry): CachePort {
  return guardCache(cache, metrics);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

/** Lets every pending fetch reach the source before the answer is released. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
