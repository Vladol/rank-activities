## Why

The assignment states one operational requirement in a single sentence: *persist it rather
than calling the API on every request; how you model, store and refresh it is part of the
problem*. Five specs later, **no requirement anywhere says the service must not call
Open-Meteo on every request.** `weather-sources` deferred it ("caching, stale-while-revalidate,
single-flight, retries and the circuit breaker … get their own change"), `activity-ranking`
deferred it ("how data becomes stale is the caching change"), and that change was never
written. This is it.

It is not only a gap; it is a gap that already broke something. `activity-ranking` requires:
"fresh data cannot be obtained but data previously obtained is available → the answer is
produced from that data, marked stale". **"Previously obtained data" is this change.**
Implemented in numeric order, `05` reaches that scenario with nothing to satisfy it. So this
change is not a follow-up to `05` — it is a prerequisite for one of its requirements.

The numbers that decide the design were measured in stage 3 and worked out in stage 6:

- **The daily quota binds, and it is twelve times stricter than the hourly one.** 10 000
  calls/day is ≈ 416/hour sustained, while the hourly limit of 5 000 permits burning half a
  day's budget in one hour — which is what a traffic spike does by itself.
- **A retry spends quota exactly like a first attempt**, and retries become frequent
  precisely when the source is degraded. Counting user requests instead of attempts
  undercounts by up to 3× at the worst possible moment.
- **The horizon in the cache key doubled misses on identical data**: a 3-day and a 7-day
  request for one city produced two calls, though the 7-day response contains the 3-day one.
- **Latency is 136 ms with a 5 ms spread, of which 27 ms is TCP+TLS.** The source is fast and
  stable; the cache exists for the quota and for surviving the source's absence, not to hide
  a slow API. That distinction decides what happens on a miss.
- **A city name is user input that becomes a cache key.** A thousand invented names is a
  thousand outbound calls and a thousand LRU entries evicting the useful ones.

## What Changes

- **A cache in front of every source seam**, with a per-capability lifetime aligned to the
  hour boundary rather than to the moment of the request, so invalidation happens in step
  with the source's own refresh rather than an hour after whoever asked first.
- **Stale data is an answer, not an error.** When refreshing fails and a previous answer
  exists, that answer is served immediately, marked stale, with the honest time it was
  obtained — satisfying the requirement `activity-ranking` already states.
- **Concurrent misses collapse into one outbound call.** The rest wait for it rather than
  reproducing it.
- **The key is built in exactly one place and does not contain the horizon.** The maximum
  horizon is always fetched and sliced locally, removing an entire dimension of
  fragmentation.
- **Only plain data is cached**, with an explicit codec per cached type and a round-trip test
  in which a `null` inside a series must remain `null` — because the first value that crosses
  a process boundary is where a method-carrying object dies silently.
- **A mapper version guards the namespace.** Changing a canonical unit makes existing entries
  unreachable instead of serving values that differ by a factor of 3.6 while every test stays
  green.
- **Unknown locations are cached negatively** with a short lifetime, and the store is bounded
  by both entry count and estimated size.
- **An outbound budget counted in attempts**, across three windows, that sheds with a reason
  when exhausted instead of queueing — because a queue converts an exhausted quota into a
  rising p95, which is an outage disguised as slowness.
- **Retries that distinguish status classes, a breaker per source-and-capability pair, and a
  timeout per attempt** — so a failing wave model costs surfing and not the forecast.
- **A cache that cannot answer behaves as a miss** and never fails a request.

**Out of scope, deliberately:**

- Redis. The port and the codecs are built so the adapter is one file, and stage 6 §9.4 sets
  the trigger: a second instance. Until then the in-memory adapter is the implementation and
  the `null` adapter is what tests use.
- Persisting anything durable — location profiles, probe state, the geocoding table. That is
  `08-add-data-persistence`; this change owns volatile data with a lifetime.
- Warming the cache in the background. Removed from v1 in stage 6 §5.7: 136 ms does not
  justify a scheduler and a distributed lock.
- Throttling inbound requests. It protects a different thing and belongs with the API
  contract in `09-add-graphql-api`; this change protects the source from us.

## Capabilities

### New Capabilities

- `source-caching`: keeping the service off the source's network path — lifetimes and key
  construction, staleness as an answer, miss deduplication, negative caching and bounds, the
  attempt-counted outbound budget, retry and breaker behaviour, and the failure modes of the
  cache itself.

### Modified Capabilities

None. `activity-ranking` already requires that staleness be declared; this change supplies
the mechanism that makes that requirement satisfiable, without restating it.

## Impact

| Area | Effect |
|---|---|
| `src/common/cache/` | `CachePort`, memory and null adapters, `cache-keys.ts`, codecs, single-flight, stale-while-revalidate |
| `src/modules/weather/decorators/` | Cached, resilient and observed wrappers over the capability ports |
| `src/modules/weather/outbound-budget/` | Token buckets over three windows, bulkhead, shedding |
| `src/domain/shared/coordinates.ts` | `gridKey` becomes a pure function rather than a method |
| `src/config/` | Lifetimes, bounds and budget windows as configuration, not constants |
| `openspec/changes/05-add-activity-ranking` | **Unblocks** its stale-answer requirement; see design.md Context |
| `openspec/changes/06-add-open-meteo-source` | Prerequisite: the adapter these decorators wrap, and `MAPPER_VERSION` |
| Dependencies | `lru-cache`, `cockatiel` — first consumers arrive here |
