import { type CacheKey, seriesKey } from '../../../common/cache/cache-keys';
import type { CachePort } from '../../../common/cache/cache.port';
import { weatherSeriesCodec } from '../../../common/cache/codecs';
import { type Lifetime, expiresAt, freshUntil } from '../../../common/cache/freshness';
import { SingleFlight } from '../../../common/cache/single-flight';
import { METRIC, type MetricsRegistry } from '../../../common/metrics/metrics.registry';
import type { Result } from '../../../domain/shared/result';
import type { Capability } from '../../../domain/weather/metric';
import { sliceToDays } from '../../../domain/weather/slice-series';
import { type WeatherSeries, markStale } from '../../../domain/weather/weather-series';
import type { SeriesRequest, WeatherError } from '../ports/contracts';
import type { SeriesPort } from '../ports/series.port';

export interface CachedSeriesOptions {
  readonly cache: CachePort;
  readonly lifetimes: Readonly<Record<Capability, Lifetime>>;
  /**
   * The horizon every rolling request is widened to before it leaves the
   * process. Clamped by what the source declares, so widening can never turn a
   * valid request into one the source refuses.
   */
  readonly maxForecastDays: number;
  readonly now?: () => number;
  readonly metrics?: MetricsRegistry;
  /**
   * Handed every background revalidation. The caller of `fetch` never waits
   * for one; this is how a test awaits it and how an operator gets to log it.
   */
  readonly onRevalidate?: (settled: Promise<void>) => void;
}

type SeriesResult = Result<WeatherSeries, WeatherError>;

/**
 * The cache in front of a capability port: freshness on the source's own
 * boundary, staleness as an answer, and one outbound call per key.
 *
 * The order inside matters. The cache comes before the deduplicator, so a hit
 * never reaches it; the deduplicator wraps only the miss, which is the thing
 * worth deduplicating (stage-four.md, section 5.4).
 */
export function cacheSeriesPort<Served extends Capability>(
  port: SeriesPort<Served>,
  options: CachedSeriesOptions,
): SeriesPort<Served> {
  const now = options.now ?? ((): number => Date.now());
  const label = { source: port.sourceId, capability: port.capability };
  const flight = new SingleFlight<SeriesResult>(() =>
    options.metrics?.increment(METRIC.singleFlightJoins, label),
  );

  const lifetime = (): Lifetime => options.lifetimes[port.capability];

  const record = (outcome: string): void => {
    options.metrics?.increment(METRIC.cacheOperations, { ...label, outcome });
  };

  /** The call that actually leaves, and the write of what it brought back. */
  const obtain = async (key: CacheKey, outbound: SeriesRequest): Promise<SeriesResult> => {
    const answered = await port.fetch(outbound);

    if (answered.ok) {
      const at = now();

      await options.cache.set(key, {
        payload: JSON.stringify(weatherSeriesCodec.encode(answered.value)),
        storedAt: at,
        freshUntil: freshUntil(at, lifetime().ttlSeconds),
        expiresAt: expiresAt(at, lifetime()),
      });
    }

    return answered;
  };

  return {
    get sourceId(): string {
      return port.sourceId;
    },
    get capability(): Served {
      return port.capability;
    },
    get limits() {
      return port.limits;
    },
    supports: (metric) => port.supports(metric),
    fetch: async (request: SeriesRequest): Promise<SeriesResult> => {
      const outbound = widen(request, options.maxForecastDays, port.limits.maxForecastDays);
      const key = seriesKey({
        capability: port.capability,
        location: outbound.location,
        metrics: outbound.metrics,
        horizon: outbound.horizon,
        timezone: outbound.timezone,
      });

      const stored = await options.cache.get(key);
      // Expiry is checked here as well as by the adapter: the contract says a
      // record past `expiresAt` is not servable, and a caller that relied on
      // the adapter to enforce it would start serving week-old forecasts the
      // day a store with looser eviction is bound.
      const live = stored !== undefined && now() < stored.expiresAt ? stored : undefined;
      const cached = live === undefined ? undefined : decode(live.payload);

      if (live !== undefined && cached !== undefined) {
        if (now() < live.freshUntil) {
          record('hit');

          return { ok: true, value: answer(cached, request, false) };
        }

        // Stale, and served as an answer rather than as a failure: the data is
        // there, it is old, and the answer says so with the moment it was
        // obtained (spec, "Stale data is served as an answer").
        //
        // The refresh is started unconditionally and the hook only observes
        // it: starting it inside `onRevalidate?.(...)` would make the whole
        // mechanism depend on a hook nothing but the tests passes.
        record('stale');
        const refreshing = revalidate(flight, key, outbound, obtain);

        options.onRevalidate?.(refreshing);

        return { ok: true, value: answer(cached, request, true) };
      }

      record('miss');
      const answered = await flight.run(key, () => obtain(key, outbound));

      return answered.ok ? { ok: true, value: answer(answered.value, request, false) } : answered;
    },
  };
}

/**
 * The refresh that follows a stale answer. It goes through the same
 * deduplicator as a miss, so a burst of stale reads produces one call, and it
 * never rejects: nobody is waiting for it, and an unhandled rejection here
 * would take the process down for a refresh that failed.
 */
function revalidate(
  flight: SingleFlight<SeriesResult>,
  key: CacheKey,
  outbound: SeriesRequest,
  obtain: (key: CacheKey, outbound: SeriesRequest) => Promise<SeriesResult>,
): Promise<void> {
  return flight.run(key, () => obtain(key, outbound)).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Always ask for the longest horizon this source will give, and slice locally.
 *
 * Days of history are left alone: they move the origin of the axis rather than
 * extend its end, so a longer answer does not contain a shorter one and the
 * key keeps them apart.
 */
function widen(request: SeriesRequest, wanted: number, declared: number): SeriesRequest {
  if (request.horizon.kind !== 'forecast' || (request.horizon.pastDays ?? 0) > 0) {
    return request;
  }

  const forecastDays = Math.max(request.horizon.forecastDays, Math.min(wanted, declared));

  return forecastDays === request.horizon.forecastDays
    ? request
    : { ...request, horizon: { ...request.horizon, forecastDays } };
}

/** What the caller asked for, out of what was fetched, saying how old it is. */
function answer(series: WeatherSeries, request: SeriesRequest, stale: boolean): WeatherSeries {
  const sliced =
    request.horizon.kind === 'forecast' && (request.horizon.pastDays ?? 0) === 0
      ? sliceToDays(series, request.horizon.forecastDays)
      : series;

  return markStale(sliced, stale);
}

function decode(payload: string): WeatherSeries | undefined {
  try {
    return weatherSeriesCodec.decode(JSON.parse(payload));
  } catch {
    // A payload that is not JSON is a miss, like every other thing the cache
    // cannot answer with (design.md, Decision 9).
    return undefined;
  }
}
