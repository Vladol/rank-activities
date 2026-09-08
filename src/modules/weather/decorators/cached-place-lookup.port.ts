import { placeKey } from '../../../common/cache/cache-keys';
import type { CachePort } from '../../../common/cache/cache.port';
import { placeCandidatesCodec } from '../../../common/cache/codecs';
import { type Lifetime, expiresAt, freshUntil } from '../../../common/cache/freshness';
import { SingleFlight } from '../../../common/cache/single-flight';
import { METRIC, type MetricsRegistry } from '../../../common/metrics/metrics.registry';
import type { Result } from '../../../domain/shared/result';
import type { WeatherError } from '../ports/contracts';
import type { PlaceCandidate, PlaceLookupPort, PlaceQuery } from '../ports/place-lookup.port';

export interface CachedPlaceLookupOptions {
  readonly cache: CachePort;
  /** How long a name that resolved stays resolved. */
  readonly lifetime: Lifetime;
  /**
   * How long a name that resolved to nothing is remembered as nothing. Short
   * on purpose: it has to outlast a flood of invented names without outlasting
   * a corrected typo (stage-six.md, section 9.3).
   */
  readonly negativeLifetime: Lifetime;
  readonly now?: () => number;
  readonly metrics?: MetricsRegistry;
}

type LookupResult = Result<readonly PlaceCandidate[], WeatherError>;

/**
 * The cache in front of place lookup, and the only place a *negative* answer
 * is kept.
 *
 * A place name is user input that becomes a cache key, and an enumeration of
 * invented names is an outbound call and an LRU entry each. Remembering that a
 * name resolved to nothing is what stops the first; the store's own bounds
 * stop the second (stage-six.md, section 5.4).
 *
 * A lookup that *failed* is not cached at all: the source being unreachable is
 * not a fact about the world, and caching it would turn an outage into a place
 * that does not exist.
 */
export function cachePlaceLookup(
  port: PlaceLookupPort,
  options: CachedPlaceLookupOptions,
): PlaceLookupPort {
  const now = options.now ?? ((): number => Date.now());
  const flight = new SingleFlight<LookupResult>(() =>
    options.metrics?.increment(METRIC.singleFlightJoins, { source: port.sourceId }),
  );

  const record = (outcome: string): void => {
    options.metrics?.increment(METRIC.cacheOperations, { source: port.sourceId, outcome });
  };

  return {
    get sourceId(): string {
      return port.sourceId;
    },
    lookup: async (query: PlaceQuery): Promise<LookupResult> => {
      const key = placeKey(query);
      const stored = await options.cache.get(key);

      // Freshness and expiry are the same moment for a name, and both are
      // checked here rather than left to the adapter: the contract puts them
      // on the record, and an adapter that evicts more loosely must not turn
      // into a lookup that never refreshes.
      if (stored !== undefined && now() < stored.freshUntil && now() < stored.expiresAt) {
        const cached = decode(stored.payload);

        if (cached !== undefined) {
          record(cached.length === 0 ? 'negative_hit' : 'hit');

          return { ok: true, value: cached };
        }
      }

      record('miss');

      return flight.run(key, async () => {
        const answered = await port.lookup(query);

        if (!answered.ok) {
          return answered;
        }

        const at = now();
        const lifetime: Lifetime =
          answered.value.length === 0 ? options.negativeLifetime : options.lifetime;

        await options.cache.set(key, {
          payload: JSON.stringify(placeCandidatesCodec.encode(answered.value)),
          storedAt: at,
          freshUntil: freshUntil(at, lifetime.ttlSeconds),
          // A place lookup has no stale-while-revalidate: the name either
          // resolves or it does not, and an old answer to it is not an answer
          // of a different quality. Freshness and expiry are the same moment.
          expiresAt: expiresAt(at, lifetime),
        });

        return answered;
      });
    },
  };
}

function decode(payload: string): readonly PlaceCandidate[] | undefined {
  try {
    return placeCandidatesCodec.decode(JSON.parse(payload));
  } catch {
    return undefined;
  }
}
