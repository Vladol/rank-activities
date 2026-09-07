## Context

`06-add-open-meteo-source` produced a source that fetches. This change is everything that
stands between the use case and that source: the cache, the deduplicator, the breaker, the
retry, the outbound budget and the timeout. `01/design.md` deliberately kept the ports free
of all of it so that the adapter would stay a plain implementation, and this is where the
debt is paid.

**Order matters more than usual here.** `05-add-activity-ranking` already requires an answer
built from previously obtained data and marked stale. Nothing before this change can produce
"previously obtained data", so `05` cannot be finished before this change lands — the numeric
order of the change names is the order they were written, not the order they can be
implemented. The dependency is recorded in `stage-four.md` §15 and in the roadmap table of
`stage-six.md` §8.

The decisions below were taken in stage 6 and recorded as [ADR 0005](../../../docs/adr/0005-cache-contract.md)
(the cache contract) and [ADR 0006](../../../docs/adr/0006-outbound-call-budget.md) (the
outbound budget). This document does not re-argue them; it states what they imply for
behaviour and names the alternatives that were rejected.

## Goals / Non-Goals

**Goals:**

- A repeated request for a known location makes no outbound call at all.
- The source being slow, absent or exhausted degrades the answer in a way the answer admits
  to, and never turns into a failed request when older data exists.
- The quota is spent by a counter that counts what actually leaves the process.

**Non-Goals:**

- Hiding source latency. At 136 ms with a 5 ms spread there is little to hide; the cache is
  here for the quota and for availability.
- Distributed coordination. Single-flight is per process, and stays that way.
- Durable storage. Everything here has a lifetime; what must survive a restart is `08`.

## Decisions

### Decision 1: Our own cache port, not a cache framework

A `CachePort` with `memory`, `null` and a later `redis` adapter, and roughly 120 lines of our
own code.

**Alternative rejected: `@nestjs/cache-manager` with `cache-manager` and `keyv`.** The
standard Nest path, and it was in the stage 1 plan. It puts three layers between two of ours
for the sake of `get` and `set`, none of them knows what stale means — so stale-while-revalidate
is ours regardless — and the underlying API has already been rewritten once across a major
version.

### Decision 2: The key contains no horizon, and the maximum horizon is always fetched

Outbound requests always ask for the full supported horizon; the answer is sliced to what was
requested.

**Alternative rejected: keying by the requested horizon.** It is the honest reading — cache
what you asked for. It also doubles misses and quota consumption on identical data, because
the longer response contains the shorter one. `activity-ranking` requires the *answer* to
cover exactly the days requested, and slicing locally satisfies that; stage 6 §8 checked this
against the requirement explicitly.

### Decision 3: The mapped series is cached, not the raw response

**Alternative rejected: caching the vendor's raw body.** It decouples the cache from the
mapper and removes the need for a version guard. It also makes every hit pay for validation
and unit conversion again — the cache stops being a cache exactly where it is needed, and the
saved coupling is replaced by a slower hot path.

### Decision 4: Only plain data is cached, with an explicit codec

No classes, no methods, no `Map`, no `Date` — and a round-trip test per cached type in which
a `null` inside a series must survive as `null`.

**Alternative rejected: caching domain objects directly.** It works perfectly in memory,
which is the trap: the failure appears only when a Redis adapter is introduced, and it appears
as a method call on a structurally-similar corpse rather than as a read error. `Coordinates`
already declared `gridKey()` as a method; it becomes a pure function here.

### Decision 5: The version guard lives in the key prefix

The mapper version from `06` prefixes every key.

**Alternative rejected: flushing the cache on deploy.** Simpler and needs no constant. It
also depends on someone remembering, and the failure it prevents is the quietest one in the
system: after a canonical unit changes, a warm entry serves values off by 3.6× while every
test passes, because the tests take the fresh path and the user takes the warm one.

### Decision 6: Exhausting the budget sheds, it does not queue

A request that finds no budget left is answered as missing data with a retryable reason.

**Alternative rejected: queueing until a token frees.** It preserves the answer and converts
an exhausted quota into growing latency — an outage disguised as slowness, arriving without a
single error to point at. Shedding is visible in a metric and in the answer's own reason code.

### Decision 7: The budget counts attempts, and the limiter sits inside the retry

**Alternative rejected: placing the limiter outside the retry**, where one token would pay for
one logical call. One token would then cover up to three real calls, and the counter would
understate consumption by exactly the factor by which it matters — retries multiply when the
source degrades.

**Alternative rejected: `@nestjs/throttler` as the whole answer.** It counts inbound requests.
A cache hit costs zero outbound calls and a new coastal location costs five; the relation is
not constant, so an inbound counter cannot protect an outbound quota. The throttler still has
a job — bounding how fast new cache keys can be created — and it belongs to the API change.

### Decision 8: The breaker is per source and capability, not per source

**Alternative rejected: one breaker per source.** Fewer moving parts. It also lets a wave-model
outage open the breaker for the forecast served by the same vendor, turning a partial failure
into a total one — which `activity-ranking` forbids in as many words.

### Decision 9: A cache that cannot answer is a miss

Any failure of the cache adapter is treated as a miss, both on read and on write.

**Alternative rejected: failing the request when the cache fails.** It surfaces the problem
immediately. It also makes an accelerator into a source of outages: the service would stop
answering for a reason that has nothing to do with its ability to answer. The cost — a higher
outbound call rate — is visible in the budget metric.

### Decision 10: Single-flight is per process and stays there

**Alternative rejected: a distributed lock.** With a handful of instances, the cost of N
simultaneous misses is smaller than the cost of a lock that must be released when its holder
dies. A shared cache converts most of those misses into hits anyway. Revisited when the
instance count makes the arithmetic change.

## Risks / Trade-offs

- **Always fetching the maximum horizon transfers more bytes than asked for.** Bounded: the
  default horizon is already the maximum, and a full hourly response is 4.2 KB compressed.
- **Serving stale data means serving data known to be old.** Mitigation: it is marked stale
  with the time it was obtained, and there is a limit past which staleness becomes a miss.
  An answer that hides its age would be the actual defect.
- **The negative cache can hold a typo that the user then corrects.** Mitigation: a short
  lifetime — stage 6 §9.3 leaves the exact value to the miss-rate metric rather than to a
  guess.
- **Three counters, a bulkhead, a breaker and a retry is a lot of policy for one vendor.**
  Accepted: each one is answering a failure mode observed or documented in stage 3, and they
  are configuration over one wrapper, not code per source.
- **In-memory caching means an instance restart empties it.** Accepted here; what must
  survive a restart is durable state, and that is `08`.

## Open Questions

- Whether the staleness limit is one value or per capability. Archive data never goes stale;
  a forecast from yesterday is worthless. Likely per capability, decided with the first
  measurement.
- Whether a rate-limit failure from the source and a locally exhausted budget should share one
  reason code. Both mean "try later" to a client and different things to an operator; `06`
  raises the same question from the other side.
- Whether the geocoding lifetime belongs here or with the durable table in `08`. It is 30 days
  and it needs to survive a restart, which argues for `08`; it is a cache by nature, which
  argues for here. Stage 6 §12.2 leaves it open deliberately.
