# source-caching Specification

## Purpose
Keeping the service off the source's network path: what must be true about lifetimes, keys,
staleness, deduplication and the outbound budget so that a repeated question costs nothing,
an absent source costs honesty rather than an error, and an exhausted quota is refused with a
reason instead of hidden as latency.

## Requirements

### Requirement: Data already obtained is reused instead of re-requested

The service SHALL serve a request from previously obtained data while that data is within the
lifetime configured for its capability, and SHALL make no outbound call while doing so.

#### Scenario: A repeated request makes no outbound call

- **WHEN** the same location is ranked twice within the lifetime of its data
- **THEN** the second answer is produced without any outbound call
- **AND** both answers report the same time of obtaining the data

#### Scenario: Lifetimes differ by capability

- **WHEN** data is obtained from capabilities whose sources refresh at different cadences
- **THEN** each is reused for the lifetime configured for that capability
- **AND** the lifetimes are configuration rather than values embedded in code

#### Scenario: A lifetime ends on the boundary, not an hour after the question

- **WHEN** data is obtained partway through a refresh interval of the source
- **THEN** it stops being fresh at the boundary of that interval
- **AND** two requests made at different moments within one interval expire together

### Requirement: Stale data is served as an answer, and its age is stated

When data cannot be refreshed and previously obtained data exists within the tolerated
staleness limit, the service SHALL answer from that data, SHALL mark the answer stale, and
SHALL state when the data was obtained.

#### Scenario: An unreachable source does not fail a request that can be answered

- **WHEN** the source is unavailable and data obtained earlier is still within the staleness
  limit
- **THEN** the answer is produced from that data immediately
- **AND** it is marked stale and carries the time the data was obtained

#### Scenario: Refreshing continues after the stale answer is served

- **WHEN** a stale answer is served
- **THEN** a refresh is attempted without the caller waiting for it
- **AND** a successful refresh makes subsequent answers fresh

#### Scenario: Beyond the staleness limit there is no answer to give

- **WHEN** the only data available is older than the tolerated limit
- **THEN** it is not served
- **AND** the request is treated as having no data rather than as having stale data

### Requirement: Simultaneous misses produce one outbound call

When several requests need the same absent data at the same time, the service SHALL perform
one outbound call and SHALL serve all of them from its result.

#### Scenario: A burst on one expired location calls the source once

- **WHEN** many requests for the same location arrive after its data has expired
- **THEN** exactly one outbound call is made
- **AND** every request receives the same result

#### Scenario: A failed shared call fails all its waiters the same way

- **WHEN** the single outbound call fails
- **THEN** every waiting request receives the same typed failure
- **AND** no waiter retries the call on its own

### Requirement: The key is built in one place and excludes the horizon

The service SHALL derive every cache key through a single key builder, SHALL NOT include the
requested number of days in the key, and SHALL request the maximum supported horizon
outbound, slicing the answer locally.

#### Scenario: Two horizons for one location share one entry

- **WHEN** a location is requested for a short horizon and then for a longer one within the
  data's lifetime
- **THEN** exactly one outbound call is made for both
- **AND** each answer covers exactly the number of days it requested

#### Scenario: The metric set does not fragment the key

- **WHEN** the same metrics are requested in a different order
- **THEN** the same key is produced

#### Scenario: Keys have one origin

- **WHEN** the codebase is searched for key construction
- **THEN** keys are assembled only by the key builder
- **AND** no caller composes a key from parts

### Requirement: A change of mapping makes existing entries unreachable

The service SHALL namespace cached values by the version of the mapping that produced them,
so that a change to a canonical unit or to a mapper cannot serve values produced by the
previous mapping.

#### Scenario: Raising the mapping version bypasses warm entries

- **WHEN** the mapping version changes and a location with warm data is requested
- **THEN** the previous entry is not served
- **AND** the data is obtained again through the new mapping

#### Scenario: The guard is not a manual step

- **WHEN** the service starts
- **THEN** the namespace in force is derived from the declared mapping version
- **AND** no flush or manual invalidation is required for correctness

### Requirement: Only plain data is cached, and a gap stays a gap

The service SHALL cache only values that survive serialisation unchanged, SHALL define an
explicit encoding and decoding for each cached type, and SHALL preserve missing values as
missing.

#### Scenario: A cached series returns identical to the one stored

- **WHEN** a series is encoded, decoded and compared with the original
- **THEN** the two are structurally equal
- **AND** every missing value is still missing rather than zero

#### Scenario: No cached value depends on behaviour

- **WHEN** a value is prepared for the cache
- **THEN** it carries no methods and no types that lose meaning when serialised
- **AND** identity derived from such a value is computed by a function, not by the value
  itself

### Requirement: Absent locations are remembered, and the store is bounded

The service SHALL cache a negative lookup result for a short lifetime, and SHALL bound the
store by both the number of entries and their estimated size.

#### Scenario: A repeated unknown name does not reach the source

- **WHEN** the same unknown place name is requested twice within the negative lifetime
- **THEN** the second request makes no outbound call
- **AND** it receives the same not-found reason

#### Scenario: A corrected name is not held hostage

- **WHEN** a name that was previously not found becomes resolvable after the negative
  lifetime elapses
- **THEN** it is looked up again

#### Scenario: Volume does not evict everything useful

- **WHEN** many distinct unresolvable names are requested in a short period
- **THEN** the store stays within its configured bounds
- **AND** eviction is bounded by both count and size rather than by count alone

### Requirement: The outbound budget counts attempts, across every window

The service SHALL account for every outbound attempt — retries included — against limits
configured for each of the source's windows, and SHALL expose how much of each window remains.

#### Scenario: A retried call spends more than one unit of budget

- **WHEN** an outbound call fails and is retried twice before succeeding
- **THEN** three units of budget are consumed
- **AND** the remaining budget reflects all three

#### Scenario: A served-from-cache request spends nothing

- **WHEN** a request is answered without an outbound call
- **THEN** no budget is consumed

#### Scenario: Remaining budget is observable per window

- **WHEN** the service is running
- **THEN** the remaining budget of each configured window is exposed as a metric

### Requirement: An exhausted budget is refused with a reason, never queued

When no budget remains, the service SHALL answer the affected activities as missing data with
a retryable reason, and SHALL NOT hold the request waiting for budget to become available.

#### Scenario: Exhaustion answers rather than waits

- **WHEN** a request needs an outbound call and no budget remains in any window
- **THEN** the affected activities report missing data with a retryable busy reason
- **AND** the request is answered without waiting for the window to roll over

#### Scenario: Exhaustion does not hide behind latency

- **WHEN** the budget is exhausted under load
- **THEN** response times do not grow as a consequence
- **AND** the refusal is visible as a counted outcome

### Requirement: Failures are contained to the capability that failed

The service SHALL apply its failure policy per source and capability pair, SHALL bound each
attempt in time, and SHALL distinguish retryable failures from those that will not improve.

#### Scenario: One failing capability does not stop another

- **WHEN** repeated failures cause one capability of a source to be cut off
- **THEN** other capabilities of the same source continue to be called
- **AND** the answer loses only the activities that depended on the failed capability

#### Scenario: Only failures worth retrying are retried

- **WHEN** a call fails with a rejection that repeating cannot fix
- **THEN** it is not retried
- **AND** a failure that may pass — a rate limit, a server fault or a network fault — is
  retried with growing, jittered delay

#### Scenario: A stated retry delay is honoured

- **WHEN** a source states how long to wait before retrying
- **THEN** that delay is respected rather than the default backoff

### Requirement: A cache that cannot answer behaves as a miss

The service SHALL treat any failure of the cache itself as absence of data, on both reading
and writing, and SHALL NOT fail a request because the cache failed.

#### Scenario: An unavailable cache does not break ranking

- **WHEN** the cache fails every read and every write
- **THEN** requests are answered by calling the source
- **AND** no request fails because of the cache

#### Scenario: The cost of a degraded cache is visible

- **WHEN** the cache is failing
- **THEN** the rise in outbound calls is visible in the budget and cache metrics
