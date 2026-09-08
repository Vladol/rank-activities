import type { CacheKey } from './cache-keys';

/**
 * The seam every cached value passes through.
 *
 * A record is stored as **text**, not as an object, and that is the whole
 * point of the shape: the in-memory adapter pays the same serialisation cost a
 * Redis adapter would, so a value that cannot survive the crossing fails here,
 * in development, rather than the first time a second instance appears
 * (ADR 0005, and design.md Decision 4).
 */
export interface CacheRecord {
  /** The encoded value, as JSON text. */
  readonly payload: string;
  /**
   * When the value was obtained, as a millisecond epoch. It is the honest
   * answer to "how old is this?" that a stale answer has to carry, so it is
   * stored rather than re-derived from the moment of reading.
   */
  readonly storedAt: number;
  /** The moment the value stops being fresh — a boundary, not an offset. */
  readonly freshUntil: number;
  /** The moment it stops being servable at all, stale or otherwise. */
  readonly expiresAt: number;
}

/**
 * Read, write, forget. Deciding what is fresh, what is stale and what is worth
 * a second call belongs to the layer above: an adapter that knew about
 * staleness would have to be reimplemented for every store.
 *
 * Implementations may reject. Callers must not care — a cache that cannot
 * answer is a miss (design.md, Decision 9), which `guardCache` enforces so
 * that no call site has to remember it.
 */
export interface CachePort {
  /** Identifies the adapter in the startup log and in the cache metrics. */
  readonly name: string;

  get(key: CacheKey): Promise<CacheRecord | undefined>;

  set(key: CacheKey, record: CacheRecord): Promise<void>;

  delete(key: CacheKey): Promise<void>;

  clear(): Promise<void>;
}

/** What a bounded store is holding, for the eviction metric and its tests. */
export interface CacheStats {
  readonly entries: number;
  readonly bytes: number;
}

export interface BoundedCachePort extends CachePort {
  stats(): CacheStats;
}

export const CACHE: unique symbol = Symbol('CachePort');

/**
 * The adapter that stores nothing.
 *
 * It is what the test configuration binds, so a fixture that stopped being
 * read cannot hide behind a hit left by the previous test
 * (stage-four.md, section 5.4).
 */
export class NullCache implements CachePort {
  readonly name = 'null';

  get(_key: CacheKey): Promise<CacheRecord | undefined> {
    return Promise.resolve(undefined);
  }

  set(_key: CacheKey, _record: CacheRecord): Promise<void> {
    return Promise.resolve();
  }

  delete(_key: CacheKey): Promise<void> {
    return Promise.resolve();
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }
}
