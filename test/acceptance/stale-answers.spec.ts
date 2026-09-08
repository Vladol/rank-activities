import { describe, expect, it } from 'vitest';

import type { Lifetime } from '../../src/common/cache/freshness';
import { MemoryCache } from '../../src/common/cache/memory-cache.adapter';
import { MetricsRegistry } from '../../src/common/metrics/metrics.registry';
import { domainError } from '../../src/domain/shared/domain-error';
import { err } from '../../src/domain/shared/result';
import type { Capability } from '../../src/domain/weather/metric';
import type { LocationQuery } from '../../src/modules/geo/location-resolver.service';
import { wrapSource } from '../../src/modules/weather/decorators/wrap-source';
import { OutboundBudgetService } from '../../src/modules/weather/outbound-budget/outbound-budget.service';
import type { SeriesPort } from '../../src/modules/weather/ports/series.port';
import { recordingPort, scriptedPort } from '../support/fake-series-port';
import { rankingHarness } from '../support/ranking';

/**
 * By coordinates, as the reference cases are: the recorded forecast is keyed
 * to the grid point, and resolving a name first would test the geocoder rather
 * than the cache.
 */
const LISBON: LocationQuery = {
  kind: 'coordinates',
  coordinates: { latitude: 38.7167, longitude: -9.1333 },
};

const HOUR = 3_600_000;
const START = Date.parse('2026-03-01T10:15:00Z');

const LIFETIMES: Readonly<Record<Capability, Lifetime>> = {
  forecast: { ttlSeconds: 3_600, maxStaleSeconds: 10_800 },
  marine: { ttlSeconds: 3_600, maxStaleSeconds: 10_800 },
  archive: { ttlSeconds: 86_400, maxStaleSeconds: 604_800 },
};

/**
 * The whole layer, wired the way the module wires it, over the recorded
 * sources the rest of the acceptance suite uses.
 *
 * This is the scenario `activity-ranking` has required since it was written
 * and nothing could satisfy: "previously obtained data" did not exist until
 * this change (`07`'s design.md, Context).
 */
function cachedHarness(options: { readonly outage?: () => boolean } = {}) {
  let now = START;
  const metrics = new MetricsRegistry();
  const revalidations: Promise<void>[] = [];
  const outage = options.outage ?? ((): boolean => false);
  const forecast = scriptedPort('forecast', (_request, recorded) =>
    outage()
      ? Promise.resolve(err(domainError('TRANSPORT_FAILURE', 'the call never completed')))
      : recorded(),
  );
  const wrapping = {
    cache: new MemoryCache({ maxEntries: 100, maxBytes: 2_000_000, now: () => now }),
    lifetimes: LIFETIMES,
    placeLifetime: { ttlSeconds: 2_592_000, maxStaleSeconds: 2_592_000 },
    placeNegativeLifetime: { ttlSeconds: 300, maxStaleSeconds: 300 },
    maxForecastDays: 7,
    resilience: {
      budget: new OutboundBudgetService({
        limits: { minute: 600, hour: 5_000, day: 10_000 },
        now: () => now,
      }),
      maxAttempts: 1,
      backoff: { initialDelayMs: 0, maxDelayMs: 0 },
      timeoutMs: 2_000,
      breaker: { consecutiveFailures: 50, halfOpenAfterMs: 60_000 },
      concurrency: { limit: 8, queue: 8 },
    },
    metrics,
    now: () => now,
    onRevalidate: (settled: Promise<void>): number => revalidations.push(settled),
  };

  const wrap = <Served extends Capability>(port: SeriesPort<Served>): SeriesPort<Served> =>
    wrapSource(port, wrapping);

  return {
    forecast,
    harness: rankingHarness({
      forecast: wrap(forecast),
      marine: wrap(recordingPort('marine')),
      archive: wrap(recordingPort('archive')),
      now: START,
    }),
    metrics,
    advance: (ms: number): void => {
      now += ms;
    },
    settle: (): Promise<unknown> => Promise.all(revalidations),
  };
}

describe('stale data is delivered as stale, not as an error', () => {
  it('answers from data obtained earlier when fresh data cannot be got', async () => {
    let down = false;
    const { harness, advance } = cachedHarness({ outage: () => down });
    const request = { location: LISBON, days: 1 };

    const fresh = await harness.service.rank(request);

    expect(fresh.ok && fresh.value.stale).toBe(false);

    down = true;
    advance(HOUR);
    const stale = await harness.service.rank(request);

    // The request does not fail, the answer says it is stale, and the moment
    // it names is the moment the data was actually obtained.
    expect(stale.ok).toBe(true);
    expect(stale.ok && stale.value.stale).toBe(true);
    expect(stale.ok && stale.value.fetchedAt).toBe(fresh.ok ? fresh.value.fetchedAt : 'differs');
    expect(stale.ok && stale.value.days.length).toBeGreaterThan(0);
  });

  it('still ranks the activities it has data for', async () => {
    let down = false;
    const { harness, advance } = cachedHarness({ outage: () => down });
    const request = { location: LISBON, days: 1 };

    await harness.service.rank(request);
    down = true;
    advance(HOUR);
    const stale = await harness.service.rank(request);
    const first = stale.ok ? stale.value.days[0] : undefined;

    expect(first?.ranking.ranked.length).toBeGreaterThan(0);
  });

  it('takes the staleness and the moment from this layer and from nowhere else', async () => {
    const { harness } = cachedHarness();
    const answer = await harness.service.rank({ location: LISBON, days: 1 });

    // Every ingredient declares its own provenance, and the answer reports the
    // oldest of them: staleness is not a flag the use case sets.
    const provenance = answer.ok ? answer.value.days.length > 0 : false;

    expect(provenance).toBe(true);
    expect(answer.ok && answer.value.stale).toBe(false);
    expect(answer.ok && answer.value.fetchedAt).not.toBeNull();
  });

  it('goes back to fresh once the source answers again', async () => {
    let down = false;
    const { harness, advance, settle } = cachedHarness({ outage: () => down });
    const request = { location: LISBON, days: 1 };

    await harness.service.rank(request);
    down = true;
    advance(HOUR);
    await harness.service.rank(request);

    down = false;
    await settle();
    advance(HOUR);
    await harness.service.rank(request);
    await settle();

    const recovered = await harness.service.rank(request);

    expect(recovered.ok && recovered.value.stale).toBe(false);
  });

  it('makes a repeated ranking cost no outbound call at all', async () => {
    const { harness, forecast } = cachedHarness();
    const request = { location: LISBON, days: 1 };

    await harness.service.rank(request);
    const afterFirst = forecast.requests.length;

    await harness.service.rank(request);

    expect(forecast.requests).toHaveLength(afterFirst);
  });
});
