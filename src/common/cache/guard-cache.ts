import { METRIC, type MetricsRegistry } from '../metrics/metrics.registry';
import type { CacheKey } from './cache-keys';
import type { CachePort, CacheRecord } from './cache.port';

/**
 * Wraps a cache so that its own failures are absence of data rather than
 * failures of the request.
 *
 * A cache that can fail a request is worse than no cache: it turns an
 * accelerator into a source of outages, for a reason that has nothing to do
 * with the service's ability to answer (design.md, Decision 9). The cost — a
 * higher outbound call rate — is what the budget metric is for, and the
 * failures themselves are counted here so a degraded cache is visible rather
 * than silent.
 */
export function guardCache(cache: CachePort, metrics?: MetricsRegistry): CachePort {
  const failed = (): void => {
    metrics?.increment(METRIC.cacheOperations, { outcome: 'error', adapter: cache.name });
  };

  return {
    get name(): string {
      return cache.name;
    },
    get: async (key: CacheKey): Promise<CacheRecord | undefined> => {
      try {
        return await cache.get(key);
      } catch {
        failed();

        return undefined;
      }
    },
    set: async (key: CacheKey, record: CacheRecord): Promise<void> => {
      try {
        await cache.set(key, record);
      } catch {
        failed();
      }
    },
    delete: async (key: CacheKey): Promise<void> => {
      try {
        await cache.delete(key);
      } catch {
        failed();
      }
    },
    clear: async (): Promise<void> => {
      try {
        await cache.clear();
      } catch {
        failed();
      }
    },
  };
}
