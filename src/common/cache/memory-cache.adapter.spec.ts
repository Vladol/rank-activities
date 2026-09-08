import { describe, expect, it } from 'vitest';

import type { CacheKey } from './cache-keys';
import { NullCache } from './cache.port';
import { MemoryCache } from './memory-cache.adapter';

/** Tests may name a key directly; production code may not (`cache-keys.ts`). */
const key = (name: string): CacheKey => name as CacheKey;

function record(payload: string, at = 0, lifetimeMs = 60_000) {
  return { payload, storedAt: at, freshUntil: at + lifetimeMs, expiresAt: at + lifetimeMs };
}

describe('the null adapter', () => {
  it('never answers, whatever was written', async () => {
    const cache = new NullCache();

    await cache.set(key('k'), record('"v"'));

    expect(await cache.get(key('k'))).toBeUndefined();
  });
});

describe('the memory adapter', () => {
  it('returns what was stored', async () => {
    const cache = new MemoryCache({ maxEntries: 10, maxBytes: 10_000, now: () => 0 });

    await cache.set(key('k'), record('{"a":1}'));

    expect((await cache.get(key('k')))?.payload).toBe('{"a":1}');
  });

  it('forgets an entry once its expiry has passed', async () => {
    let now = 0;
    const cache = new MemoryCache({ maxEntries: 10, maxBytes: 10_000, now: () => now });

    await cache.set(key('k'), record('"v"', 0, 1_000));
    now = 1_001;

    expect(await cache.get(key('k'))).toBeUndefined();
  });

  it('does not store a record that arrives already expired', async () => {
    const cache = new MemoryCache({ maxEntries: 10, maxBytes: 10_000, now: () => 5_000 });

    await cache.set(key('k'), record('"v"', 0, 1_000));

    expect(cache.stats().entries).toBe(0);
  });

  // The two bounds are tested apart because either one alone leaves a way to
  // exhaust the store: many tiny entries, or a few large ones.
  it('is bounded by the number of entries', async () => {
    const cache = new MemoryCache({ maxEntries: 3, maxBytes: 1_000_000, now: () => 0 });

    for (let index = 0; index < 20; index += 1) {
      await cache.set(key(`k${index}`), record('"v"'));
    }

    expect(cache.stats().entries).toBe(3);
    expect(await cache.get(key('k0'))).toBeUndefined();
    expect(await cache.get(key('k19'))).toBeDefined();
  });

  it('is bounded by the estimated size, with the entry count left slack', async () => {
    const cache = new MemoryCache({ maxEntries: 1_000, maxBytes: 400, now: () => 0 });
    const payload = `"${'x'.repeat(99)}"`;

    for (let index = 0; index < 20; index += 1) {
      await cache.set(key(`k${index}`), record(payload));
    }

    expect(cache.stats().bytes).toBeLessThanOrEqual(400);
    expect(cache.stats().entries).toBeLessThan(20);
    expect(await cache.get(key('k19'))).toBeDefined();
  });

  it('drops what it was asked to forget', async () => {
    const cache = new MemoryCache({ maxEntries: 10, maxBytes: 10_000, now: () => 0 });

    await cache.set(key('k'), record('"v"'));
    await cache.delete(key('k'));

    expect(await cache.get(key('k'))).toBeUndefined();
  });
});
