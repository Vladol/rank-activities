## 1. Cache port and codecs

- [ ] 1.1 Add `src/common/cache/cache.port.ts` with the DI token and the `null` adapter;
      bind `null` in the test configuration so no test can hide a fixture miss behind a hit.
- [ ] 1.2 Add the memory adapter over `lru-cache`, bounded by entry count and by size
      estimate; install `lru-cache` with this task. Test both bounds independently.
- [ ] 1.3 Turn `Coordinates.gridKey()` into a pure function; verify no cached type carries a
      method, a `Map` or a `Date`.
- [ ] 1.4 Write a failing round-trip test in which a `null` inside an hourly series must
      survive `decode(encode(x))`, then add the `WeatherSeries` codec.
- [ ] 1.5 Add codecs for every other cached type; make the round-trip test table-driven so a
      new cached type without a codec fails the suite.

## 2. Keys

- [ ] 2.1 Add `src/common/cache/cache-keys.ts`; test that the same metric set in a different
      order yields the same key.
- [ ] 2.2 Test that two different horizons for one location yield the same key, and that the
      outbound request always carries the maximum horizon.
- [ ] 2.3 Test that the answer is sliced locally to the requested days, and that
      `activity-ranking`'s "covers exactly the requested days" still holds.
- [ ] 2.4 Prefix keys with the mapping version from `06`; test that raising it makes a warm
      entry unreachable.
- [ ] 2.5 Add a lint or test assertion that key strings are assembled nowhere but in
      `cache-keys.ts`.

## 3. Freshness, staleness and deduplication

- [ ] 3.1 Write failing tests for the hour-boundary lifetime, then implement it; test that two
      entries created at different moments in one interval expire together.
- [ ] 3.2 Implement per-capability lifetimes from configuration; test that a value is
      configuration, not a constant.
- [ ] 3.3 Write a failing test for stale-while-revalidate: source down, entry within the
      staleness limit → immediate answer, `stale` set, honest time of obtaining.
- [ ] 3.4 Test that the background refresh happens without the caller waiting, and that a
      successful refresh makes the next answer fresh.
- [ ] 3.5 Test that data older than the staleness limit is not served and is treated as
      absent.
- [ ] 3.6 Write a failing test with concurrent misses on one key, then add single-flight;
      assert exactly one outbound call and that a shared failure reaches every waiter.

## 4. Negative caching and poisoning

- [ ] 4.1 Write a failing test, then cache not-found lookups with a short lifetime; assert the
      second identical unknown name makes no outbound call.
- [ ] 4.2 Test that the entry expires and a name that became resolvable is looked up again.
- [ ] 4.3 Test with many distinct unresolvable names that the store stays within both bounds
      and that useful entries are not wholly evicted.
- [ ] 4.4 Normalise the place name — case, whitespace, unicode form — before the key is built;
      test that three spellings of one city share one key.

## 5. Outbound budget

- [ ] 5.1 Write a failing test asserting that a call retried twice consumes three units, then
      add the token buckets over the configured windows.
- [ ] 5.2 Test that a cache hit consumes nothing.
- [ ] 5.3 Implement shedding: no budget → missing data with a retryable busy reason; test that
      the request is answered without waiting.
- [ ] 5.4 Add the bulkhead on concurrent outbound calls; test that it bounds concurrency
      without queueing beyond its limit.
- [ ] 5.5 Expose remaining budget per window as a metric; test that it moves with consumption.

## 6. Resilience wrappers

- [ ] 6.1 Add the wrapper factory with the order from stage-four.md §5.4; install `cockatiel`
      with this task.
- [ ] 6.2 Test that the limiter sits inside the retry by asserting the attempt count against
      the budget, not by inspecting the wrapping.
- [ ] 6.3 Test that the breaker keys on the source-and-capability pair: repeated marine
      failures must not stop forecast calls to the same source.
- [ ] 6.4 Test the retry classification: a client rejection is not retried; rate limit, server
      fault and network fault are, with growing jittered delay; a stated retry delay wins over
      the default backoff.
- [ ] 6.5 Test that every cache adapter failure — read and write — behaves as a miss and never
      fails a request.

## 7. Unblocking `05`

- [ ] 7.1 Run the `activity-ranking` scenario "stale data is delivered as stale, not as an
      error" against this implementation; it must pass without amending that spec.
- [ ] 7.2 Verify the ranking answer's staleness and time-of-obtaining fields are populated
      from this layer and from nowhere else.

## 8. Close-out

- [ ] 8.1 Add the cache and budget metrics from ADR 0004: operations, hits, misses, stale
      serves, single-flight joins, breaker state, remaining budget.
- [ ] 8.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste the
      output.
- [ ] 8.3 Verify the whole suite still makes no outbound connection.
- [ ] 8.4 `/code-review` at level `high`, then `/opsx:archive`.
