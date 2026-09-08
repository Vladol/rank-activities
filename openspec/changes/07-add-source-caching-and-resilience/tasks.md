## 1. Cache port and codecs

- [x] 1.1 Add `src/common/cache/cache.port.ts` with the DI token and the `null` adapter;
      bind `null` in the test configuration so no test can hide a fixture miss behind a hit.
- [x] 1.2 Add the memory adapter over `lru-cache`, bounded by entry count and by size
      estimate; install `lru-cache` with this task. Test both bounds independently.
- [x] 1.3 Turn `Coordinates.gridKey()` into a pure function; verify no cached type carries a
      method, a `Map` or a `Date`. *(It never became a method: `locationId()` was already
      pure. `gridKey()` now lives in `cache-keys.ts`, and the plainness check is part of the
      codec suite.)*
- [x] 1.4 Write a failing round-trip test in which a `null` inside an hourly series must
      survive `decode(encode(x))`, then add the `WeatherSeries` codec.
- [x] 1.5 Add codecs for every other cached type; make the round-trip test table-driven so a
      new cached type without a codec fails the suite.

## 2. Keys

- [x] 2.1 Add `src/common/cache/cache-keys.ts`; test that the same metric set in a different
      order yields the same key.
- [x] 2.2 Test that two different horizons for one location yield the same key, and that the
      outbound request always carries the maximum horizon.
- [x] 2.3 Test that the answer is sliced locally to the requested days, and that
      `activity-ranking`'s "covers exactly the requested days" still holds.
- [x] 2.4 Prefix keys with the mapping version from `06`; test that raising it makes a warm
      entry unreachable. *(The hour bucket stage four put at the end of the key is
      deliberately absent: it would land the lookup on a different key after the boundary and
      make stale data unreachable. The boundary lives in the record's `freshUntil` instead.)*
- [x] 2.5 Add a lint or test assertion that key strings are assembled nowhere but in
      `cache-keys.ts`. *(`CachePort` takes a branded `CacheKey` only that file mints, so the
      compiler enforces it; a test greps for the one cast that could get around it.)*

## 3. Freshness, staleness and deduplication

- [x] 3.1 Write failing tests for the hour-boundary lifetime, then implement it; test that two
      entries created at different moments in one interval expire together.
- [x] 3.2 Implement per-capability lifetimes from configuration; test that a value is
      configuration, not a constant.
- [x] 3.3 Write a failing test for stale-while-revalidate: source down, entry within the
      staleness limit → immediate answer, `stale` set, honest time of obtaining.
- [x] 3.4 Test that the background refresh happens without the caller waiting, and that a
      successful refresh makes the next answer fresh.
- [x] 3.5 Test that data older than the staleness limit is not served and is treated as
      absent.
- [x] 3.6 Write a failing test with concurrent misses on one key, then add single-flight;
      assert exactly one outbound call and that a shared failure reaches every waiter.

## 4. Negative caching and poisoning

- [x] 4.1 Write a failing test, then cache not-found lookups with a short lifetime; assert the
      second identical unknown name makes no outbound call.
- [x] 4.2 Test that the entry expires and a name that became resolvable is looked up again.
- [x] 4.3 Test with many distinct unresolvable names that the store stays within both bounds
      and that useful entries are not wholly evicted.
- [x] 4.4 Normalise the place name — case, whitespace, unicode form — before the key is built;
      test that three spellings of one city share one key.

## 5. Outbound budget

- [x] 5.1 Write a failing test asserting that a call retried twice consumes three units, then
      add the token buckets over the configured windows.
- [x] 5.2 Test that a cache hit consumes nothing.
- [x] 5.3 Implement shedding: no budget → missing data with a retryable busy reason; test that
      the request is answered without waiting.
- [x] 5.4 Add the bulkhead on concurrent outbound calls; test that it bounds concurrency
      without queueing beyond its limit.
- [x] 5.5 Expose remaining budget per window as a metric; test that it moves with consumption.

## 6. Resilience wrappers

- [x] 6.1 Add the wrapper factory with the order from stage-four.md §5.4; install `cockatiel`
      with this task.
- [x] 6.2 Test that the limiter sits inside the retry by asserting the attempt count against
      the budget, not by inspecting the wrapping.
- [x] 6.3 Test that the breaker keys on the source-and-capability pair: repeated marine
      failures must not stop forecast calls to the same source.
- [x] 6.4 Test the retry classification: a client rejection is not retried; rate limit, server
      fault and network fault are, with growing jittered delay; a stated retry delay wins over
      the default backoff.
- [x] 6.5 Test that every cache adapter failure — read and write — behaves as a miss and never
      fails a request.

## 7. Unblocking `05`

- [x] 7.1 Run the `activity-ranking` scenario "stale data is delivered as stale, not as an
      error" against this implementation; it must pass without amending that spec.
- [x] 7.2 Verify the ranking answer's staleness and time-of-obtaining fields are populated
      from this layer and from nowhere else.

## 8. Close-out

- [x] 8.1 Add the cache and budget metrics from ADR 0004: operations, hits, misses, stale
      serves, single-flight joins, breaker state, remaining budget.
- [x] 8.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste the
      output.

      ```
      $ npm run lint
      (oxlint: no findings)

      $ npx tsc --noEmit
      (no type errors)

      $ npm test
      Test Files  94 passed (94)
           Tests  1008 passed | 2 skipped (1010)
        Duration  8.54s

      $ npm run test:e2e
      Test Files  5 passed (5)
           Tests  12 passed (12)
        Duration  7.65s
      ```

      `npm run test:contract` is excluded from both runs by design and reaches
      the network; it is not part of this output.
- [x] 8.3 Verify the whole suite still makes no outbound connection.

      Both vitest configs still load `test/setup/no-network.ts`, which fails any
      test that opens a non-loopback socket, and both runs above are green. The
      new layer adds no transport of its own: it wraps the ports `06` built.
- [x] 8.4 `/code-review` at level `high`, then `/opsx:archive`.

      Seven findings, all fixed, each with a regression test that fails against
      the code as reviewed:

      1. **The background refresh never ran in production.** `revalidate()` was
         the argument of `options.onRevalidate?.(...)`, so optional chaining
         short-circuited it whenever the hook was absent — which is every
         wiring but the tests'. After the lifetime, every answer was served
         stale from the same entry until it expired outright. The refresh is
         now started unconditionally and the hook only observes it.
      2. **`maxAttempts` meant one attempt more than it said.** Cockatiel
         counts retries; `maxAttempts: 3` made four calls and spent four
         tokens. Ours counts attempts, because that is what the budget spends
         and what `.env.example` documents, so it now passes `maxAttempts - 1`.
      3. **`horizonKey` dropped `forecastDays` on the `pastDays` branch**,
         where neither widening nor slicing applies — two different questions
         shared one answer.
      4. **The limits guard sat inside the wrapping**, so a horizon the source
         would refuse cost a cache lookup and a unit of every budget window.
         It is now outermost, which also removes the case where a warm entry
         answered a request that a miss would have refused.
      5. Same fix as 4.
      6. **Neither decorator checked `expiresAt`.** Expiry was enforced only by
         the memory adapter, though the contract puts it on the record — a
         shared store with looser eviction would have served week-old data as
         merely stale.
      7. **A place name was truncated to 120 characters and the truncation was
         the key**, so two names sharing a long prefix collided and the second
         was answered with the first one's coordinates. Long names now carry a
         digest, as the metric set already did.
