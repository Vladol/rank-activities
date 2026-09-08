import { LRUCache } from 'lru-cache';

import type { CacheKey } from './cache-keys';
import type { BoundedCachePort, CacheRecord, CacheStats } from './cache.port';

export interface MemoryCacheOptions {
  /** Hard ceiling on entries. */
  readonly maxEntries: number;
  /**
   * Hard ceiling on the estimated bytes held. Both bounds are needed and
   * neither is sufficient: a count alone lets a few large series exhaust the
   * heap, and a size alone lets a flood of tiny negative entries evict
   * everything useful (stage-six.md, section 5.4).
   */
  readonly maxBytes: number;
  readonly now?: () => number;
}

/**
 * The in-process adapter, and the implementation for as long as there is one
 * instance. Redis is one more file behind the same port and arrives with the
 * second instance, not before (stage-six.md, section 9.4).
 */
export class MemoryCache implements BoundedCachePort {
  readonly name = 'memory';

  private readonly store: LRUCache<string, CacheRecord>;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions) {
    this.now = options.now ?? (() => Date.now());
    this.store = new LRUCache<string, CacheRecord>({
      max: options.maxEntries,
      maxSize: options.maxBytes,
      // The key counts too: a long place name is most of a negative entry.
      sizeCalculation: (record, key) => key.length + record.payload.length,
    });
  }

  /**
   * The expiry is checked here against the injected clock as well as being
   * given to the store: `lru-cache` evicts on the real one, and a cache whose
   * correctness could only be tested by waiting is a cache nobody tests.
   */
  get(key: CacheKey): Promise<CacheRecord | undefined> {
    const record = this.store.get(key);

    if (record === undefined) {
      return Promise.resolve(undefined);
    }

    if (record.expiresAt <= this.now()) {
      this.store.delete(key);

      return Promise.resolve(undefined);
    }

    return Promise.resolve(record);
  }

  set(key: CacheKey, record: CacheRecord): Promise<void> {
    const ttl = record.expiresAt - this.now();

    // An entry that is already past its own expiry is not stored: writing it
    // would evict a live one to hold something nobody can be served.
    if (ttl > 0) {
      this.store.set(key, record, { ttl });
    }

    return Promise.resolve();
  }

  delete(key: CacheKey): Promise<void> {
    this.store.delete(key);

    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store.clear();

    return Promise.resolve();
  }

  stats(): CacheStats {
    return { entries: this.store.size, bytes: this.store.calculatedSize };
  }
}
