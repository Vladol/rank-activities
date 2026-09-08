import { describe, expect, it } from 'vitest';

import { placeCandidate, scriptedPlaceLookup } from '../../../../test/support/fake-place-lookup';
import type { Lifetime } from '../../../common/cache/freshness';
import { MemoryCache } from '../../../common/cache/memory-cache.adapter';
import { METRIC, MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { domainError } from '../../../domain/shared/domain-error';
import { err, ok } from '../../../domain/shared/result';
import { cachePlaceLookup } from './cached-place-lookup.port';

const START = Date.parse('2026-03-01T10:15:00Z');
const MINUTE = 60_000;

const RESOLVED: Lifetime = { ttlSeconds: 2_592_000, maxStaleSeconds: 2_592_000 };
const NOT_FOUND: Lifetime = { ttlSeconds: 300, maxStaleSeconds: 300 };

function harness(
  options: {
    readonly known?: readonly string[];
    readonly maxEntries?: number;
    readonly maxBytes?: number;
  } = {},
) {
  let now = START;
  const known = new Set(options.known ?? ['lisbon']);
  const metrics = new MetricsRegistry();
  const source = scriptedPlaceLookup((query) =>
    known.has(query.name.toLowerCase()) ? ok([placeCandidate({ name: query.name })]) : ok([]),
  );
  const store = new MemoryCache({
    maxEntries: options.maxEntries ?? 100,
    maxBytes: options.maxBytes ?? 1_000_000,
    now: () => now,
  });

  return {
    source,
    store,
    metrics,
    known,
    lookup: cachePlaceLookup(source, {
      cache: store,
      lifetime: RESOLVED,
      negativeLifetime: NOT_FOUND,
      now: () => now,
      metrics,
    }),
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe('a name that resolved is not looked up again', () => {
  it('answers the second identical question without a call', async () => {
    const { source, lookup } = harness();

    await lookup.lookup({ name: 'Lisbon' });
    const second = await lookup.lookup({ name: 'Lisbon' });

    expect(source.queries).toHaveLength(1);
    expect(second.ok && second.value).toHaveLength(1);
  });

  it('folds three spellings of one city into one entry', async () => {
    const { source, lookup } = harness();

    await lookup.lookup({ name: 'Lisbon' });
    await lookup.lookup({ name: '  lisbon ' });
    await lookup.lookup({ name: 'LISBON' });

    expect(source.queries).toHaveLength(1);
  });
});

describe('a name that resolved to nothing is remembered as nothing', () => {
  it('keeps the second identical unknown name off the source', async () => {
    const { source, lookup } = harness();

    const first = await lookup.lookup({ name: 'Atlantis' });
    const second = await lookup.lookup({ name: 'Atlantis' });

    expect(source.queries).toHaveLength(1);
    expect(first.ok && first.value).toEqual([]);
    expect(second.ok && second.value).toEqual([]);
  });

  it('counts a negative hit apart from an ordinary one', async () => {
    const { lookup, metrics } = harness();

    await lookup.lookup({ name: 'Atlantis' });
    await lookup.lookup({ name: 'Atlantis' });

    expect(
      metrics.read(METRIC.cacheOperations, { source: 'scripted-lookup', outcome: 'negative_hit' }),
    ).toBe(1);
  });

  it('does not hold a corrected name hostage past the short lifetime', async () => {
    const { source, lookup, known, advance } = harness();

    await lookup.lookup({ name: 'Lisbo' });
    known.add('lisbo');
    advance(10 * MINUTE);

    const second = await lookup.lookup({ name: 'Lisbo' });

    expect(source.queries).toHaveLength(2);
    expect(second.ok && second.value).toHaveLength(1);
  });

  it('keeps a resolved name far longer than an unresolved one', async () => {
    const { source, lookup, advance } = harness();

    await lookup.lookup({ name: 'Lisbon' });
    advance(10 * MINUTE);
    await lookup.lookup({ name: 'Lisbon' });

    expect(source.queries).toHaveLength(1);
  });

  it('never remembers a failure as a fact about the world', async () => {
    let now = START;
    const source = scriptedPlaceLookup(() =>
      err(domainError('TRANSPORT_FAILURE', 'the lookup could not be reached')),
    );
    const lookup = cachePlaceLookup(source, {
      cache: new MemoryCache({ maxEntries: 10, maxBytes: 100_000, now: () => now }),
      lifetime: RESOLVED,
      negativeLifetime: NOT_FOUND,
      now: () => now,
    });

    await lookup.lookup({ name: 'Lisbon' });
    await lookup.lookup({ name: 'Lisbon' });

    // The source being down does not make the place fictional.
    expect(source.queries).toHaveLength(2);
  });
});

describe('a flood of invented names stays inside the store bounds', () => {
  it('holds within both the entry count and the size estimate', async () => {
    const { lookup, store } = harness({ maxEntries: 50, maxBytes: 8_000 });

    for (let index = 0; index < 1_000; index += 1) {
      await lookup.lookup({ name: `nowhere-${index}` });
    }

    expect(store.stats().entries).toBeLessThanOrEqual(50);
    expect(store.stats().bytes).toBeLessThanOrEqual(8_000);
  });

  it('does not evict a name that keeps being asked about', async () => {
    const { lookup, source, store } = harness({ maxEntries: 20, maxBytes: 100_000 });

    await lookup.lookup({ name: 'Lisbon' });

    for (let index = 0; index < 500; index += 1) {
      await lookup.lookup({ name: `nowhere-${index}` });

      if (index % 5 === 0) {
        await lookup.lookup({ name: 'Lisbon' });
      }
    }

    // One call for Lisbon at the start and none since: the useful entry
    // survives the flood because it keeps being used, which is the whole of
    // what "least recently used" buys here.
    expect(source.queries.filter((query) => query.name === 'Lisbon')).toHaveLength(1);
    expect(store.stats().entries).toBeLessThanOrEqual(20);
  });
});
