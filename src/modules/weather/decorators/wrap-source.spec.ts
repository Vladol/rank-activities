import { describe, expect, it } from 'vitest';

import { stubPort, stubSeries } from '../../../../test/support/stub-series-port';
import type { Lifetime } from '../../../common/cache/freshness';
import { MemoryCache } from '../../../common/cache/memory-cache.adapter';
import { METRIC, MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { domainError } from '../../../domain/shared/domain-error';
import { err, ok } from '../../../domain/shared/result';
import type { Capability } from '../../../domain/weather/metric';
import { OutboundBudgetService } from '../outbound-budget/outbound-budget.service';
import type { SeriesRequest } from '../ports/contracts';
import { OBSERVED } from './observed-series.port';
import { type SourceWrappingOptions, wrapSource } from './wrap-source';

const START = Date.parse('2026-03-01T10:15:00Z');

const LIFETIMES: Readonly<Record<Capability, Lifetime>> = {
  forecast: { ttlSeconds: 3_600, maxStaleSeconds: 10_800 },
  marine: { ttlSeconds: 3_600, maxStaleSeconds: 10_800 },
  archive: { ttlSeconds: 86_400, maxStaleSeconds: 604_800 },
};

const REQUEST: SeriesRequest = {
  capability: 'forecast',
  location: { latitude: 38.72, longitude: -9.14 },
  metrics: ['temperature_2m'],
  horizon: { kind: 'forecast', forecastDays: 7 },
  timezone: 'Europe/Lisbon',
};

function harness() {
  let now = START;
  const metrics = new MetricsRegistry();
  const budget = new OutboundBudgetService({
    limits: { minute: 600, hour: 5_000, day: 10_000 },
    now: () => now,
  });
  const inner = stubPort('forecast', { sourceId: 'open-meteo-forecast' });
  const options: SourceWrappingOptions = {
    cache: new MemoryCache({ maxEntries: 100, maxBytes: 1_000_000, now: () => now }),
    lifetimes: LIFETIMES,
    placeLifetime: { ttlSeconds: 2_592_000, maxStaleSeconds: 2_592_000 },
    placeNegativeLifetime: { ttlSeconds: 300, maxStaleSeconds: 300 },
    maxForecastDays: 7,
    resilience: {
      budget,
      maxAttempts: 3,
      backoff: { initialDelayMs: 0, maxDelayMs: 0 },
      timeoutMs: 1_000,
      breaker: { consecutiveFailures: 5, halfOpenAfterMs: 60_000 },
      concurrency: { limit: 4, queue: 2 },
    },
    metrics,
    now: () => now,
  };

  return {
    inner,
    metrics,
    budget,
    port: wrapSource(inner, options),
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe('the wrapping order', () => {
  it('spends nothing on a request the cache answers', async () => {
    const { port, budget } = harness();

    await port.fetch(REQUEST);
    const afterFirst = budget.remaining('day');

    await port.fetch(REQUEST);

    // The cache is outside the budget, the breaker and the retry: a hit never
    // reaches any of them.
    expect(budget.remaining('day')).toBe(afterFirst);
  });

  it('still counts a cache hit as something the caller experienced', async () => {
    const { port, metrics } = harness();
    const label = { source: 'open-meteo-forecast', capability: 'forecast' };

    await port.fetch(REQUEST);
    await port.fetch(REQUEST);

    // `observed` is outside the cache: latency net of the cache would be a
    // number about the code rather than about the service.
    expect(metrics.read(OBSERVED.durationCount, label)).toBe(2);
    expect(metrics.read(OBSERVED.outcomes, { ...label, outcome: 'ok' })).toBe(2);
  });

  it('charges the budget for every attempt of a miss', async () => {
    const { inner, port, budget } = harness();
    let attempts = 0;

    inner.answer = (request) => {
      attempts += 1;

      return Promise.resolve(
        attempts < 3
          ? err(domainError('TRANSPORT_FAILURE', 'the call never completed'))
          : ok(stubSeries({ capability: 'forecast', request })),
      );
    };

    await port.fetch(REQUEST);

    expect(budget.remaining('day')).toBe(9_997);
  });

  it('reports a stale answer as its own outcome', async () => {
    const { inner, port, metrics, advance } = harness();

    await port.fetch(REQUEST);
    inner.answer = () => Promise.resolve(err(domainError('TIMEOUT', 'no answer')));
    advance(3_600_000);
    await port.fetch(REQUEST);

    expect(
      metrics.read(OBSERVED.outcomes, {
        source: 'open-meteo-forecast',
        capability: 'forecast',
        outcome: 'stale',
      }),
    ).toBe(1);
  });

  it('counts the cache operations under the wrapped source', async () => {
    const { port, metrics } = harness();
    const label = { source: 'open-meteo-forecast', capability: 'forecast' };

    await port.fetch(REQUEST);
    await port.fetch(REQUEST);

    expect(metrics.read(METRIC.cacheOperations, { ...label, outcome: 'miss' })).toBe(1);
    expect(metrics.read(METRIC.cacheOperations, { ...label, outcome: 'hit' })).toBe(1);
  });

  it('keeps the source contract: id, capability, limits and support pass through', () => {
    const { inner, port } = harness();

    expect(port.sourceId).toBe(inner.sourceId);
    expect(port.capability).toBe('forecast');
    expect(port.limits).toEqual(inner.limits);
    expect(port.supports('temperature_2m')).toBe(true);
  });
});
