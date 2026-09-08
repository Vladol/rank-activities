import type { CachePort } from '../../../common/cache/cache.port';
import type { Lifetime } from '../../../common/cache/freshness';
import type { MetricsRegistry } from '../../../common/metrics/metrics.registry';
import type { Capability } from '../../../domain/weather/metric';
import type { PlaceLookupPort } from '../ports/place-lookup.port';
import type { SeriesPort } from '../ports/series.port';
import { cachePlaceLookup } from './cached-place-lookup.port';
import { cacheSeriesPort } from './cached-series.port';
import { observeSeriesPort } from './observed-series.port';
import { type ResilienceOptions, resilientSeriesPort } from './resilient-series.port';

export interface SourceWrappingOptions {
  readonly cache: CachePort;
  readonly lifetimes: Readonly<Record<Capability, Lifetime>>;
  readonly placeLifetime: Lifetime;
  readonly placeNegativeLifetime: Lifetime;
  readonly maxForecastDays: number;
  readonly resilience: Omit<ResilienceOptions, 'metrics'>;
  readonly metrics: MetricsRegistry;
  readonly now?: () => number;
  readonly onRevalidate?: (settled: Promise<void>) => void;
}

/**
 * The one factory every source goes through. Cross-cutting behaviour is never
 * written into an adapter: a new adapter gets the cache, the deduplicator, the
 * breaker and the metrics without a line about any of them
 * (stage-four.md, decision 4).
 *
 * The order reads outward-in, and each step is where it is for a reason
 * (stage-four.md, section 5.4):
 *
 * ```
 * observed → cached (stale-while-revalidate) → single-flight
 *          → circuit breaker → retry → budget + bulkhead → timeout → the source
 * ```
 *
 * `observed` is outside the cache because a hit is part of what the caller
 * experiences. `cached` is outside the deduplicator because a hit has nothing
 * to deduplicate. Everything from the breaker inward runs only on a miss.
 */
export function wrapSource<Served extends Capability>(
  port: SeriesPort<Served>,
  options: SourceWrappingOptions,
): SeriesPort<Served> {
  return observeSeriesPort(
    cacheSeriesPort(resilientSeriesPort(port, { ...options.resilience, metrics: options.metrics }), {
      cache: options.cache,
      lifetimes: options.lifetimes,
      maxForecastDays: options.maxForecastDays,
      metrics: options.metrics,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.onRevalidate === undefined ? {} : { onRevalidate: options.onRevalidate }),
    }),
    { metrics: options.metrics, ...(options.now === undefined ? {} : { now: options.now }) },
  );
}

/**
 * Place lookup gets the cache — negative entries included — and nothing else
 * for now: it is one call at the front of the cold path, and the failure it
 * has to survive is a flood of invented names rather than a degraded host.
 */
export function wrapPlaceLookup(
  port: PlaceLookupPort,
  options: SourceWrappingOptions,
): PlaceLookupPort {
  return cachePlaceLookup(port, {
    cache: options.cache,
    lifetime: options.placeLifetime,
    negativeLifetime: options.placeNegativeLifetime,
    metrics: options.metrics,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
