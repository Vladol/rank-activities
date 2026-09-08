## Context

Until this change every durable-looking thing in the service was an interface with an
in-memory implementation behind it: `04-add-location-applicability` put its profile store
behind a port and deferred storage, `03-add-activity-declaration-model` loaded the catalogue
from seed files and deferred storage, and both named stage 6 as the moment it would arrive.
It arrived as three ADRs — [0003](../../../docs/adr/0003-migrations-as-a-deploy-step.md),
[0005](../../../docs/adr/0005-cache-contract.md) and
[0007](../../../docs/adr/0007-declarations-source-of-truth.md) — and a full schema in
`docs/investigation/data-model.md`, but never as requirements. This change is those decisions
written as behaviour.

**It is also a prerequisite, not a follow-up.** `location-applicability`'s two-phase marine
probe needs a record of yesterday's probe to exist today. Its own design accepted the
in-memory cost as "one extra probe"; the accurate statement is that the confirmation can never
complete on a process that restarts more often than daily, so an inland location's surfing
result stays missing-data indefinitely instead of settling on inapplicable. That change cannot
be considered done before this one lands. The dependency is recorded in `stage-four.md` §15.

## Goals / Non-Goals

**Goals:**

- Everything expensive to re-derive survives a restart; everything cheap to re-fetch does not
  enter the database at all.
- A past computation stays reproducible: the version of the rules that produced it still
  exists and still says what it said.
- The database being absent degrades a stated list of capabilities and nothing else.

**Non-Goals:**

- Being the cache. Series live in `07`; this store holds conclusions.
- Being the source of truth for rules. That stays the repository; see Decision 2.
- Query flexibility for analytics beyond the indexes named in `data-model.md` §2.6. Indexes
  follow real queries, and there is no traffic yet.

## Decisions

### Decision 1: No hourly series in the database

The store holds locations, profiles, probes, place lookups, published rules and audit. It
holds no weather series of any kind.

**Alternative rejected: a forecast table, which is the obvious reading of "persist it".** It
would make the data durable and queryable, and it would be a second, worse copy of Open-Meteo:
stale within an hour, restorable by a single 136 ms call, and immediately raising the question
of which copy is authoritative. The assignment asks that the API not be called on every
request — a cache with a lifetime satisfies that; a table that must then be refreshed,
invalidated and reconciled satisfies it worse. This is the change's main assumption and it is
stated in the README.

### Decision 2: The repository is the source of truth; the database publishes versions

Rules load into the process from seed files; the database records which versions have been
published and keeps them immutable.

**Alternative rejected: the database as the only source of rules.** One place, no duality. It
also means the service cannot start without PostgreSQL, so FR-23 — development and the whole
suite without a network — would be broken by a database rather than by a network, and a
database outage would leave the service unable to do anything at all, though the rules change
about once a month and fit comfortably in memory.

**Alternative rejected: files only, no publication.** Simpler still, and it loses the version
history that audit records point at: reproducing a month-old computation needs the version to
exist somewhere other than a git tag.

### Decision 3: Identity is computed from coordinates, not issued by the database

The identifier is derived deterministically from the rounded coordinates.

**Alternative rejected: a generated key assigned on first insert.** Conventional and index-friendly.
It also makes identity depend on insertion order and on the database being reachable, while
FR-03 requires the same city to yield the same identifier across requests — including the first
one, before any row exists.

### Decision 4: The probe table's primary key is the business rule

`(location, local date)` as the primary key makes a second probe on the same day impossible.

**Alternative rejected: enforcing "one probe per day" in the service.** It reads more
explicitly, and it is a check that a concurrent request can pass twice. `location-applicability`
requires that a probe is not repeated per request; expressing it in the key means the rule
cannot be bypassed by a race, and two rows with different dates *are* the two-phase
confirmation rather than a representation of it.

### Decision 5: "Not yet decided" is a distinct state, not a default value

Snow-season evidence is absent, positive or negative — three states, not two.

**Alternative rejected: defaulting the unknown to "no snow season".** It simplifies the type
and reproduces exactly the error the whole project is built to avoid: presenting an absence of
evidence as a negative conclusion. It is `NotApplicable` versus `NoData` again, one layer down.

### Decision 6: The service verifies the schema and never migrates itself

Migration is a deploy step. At startup the service checks the schema is the expected one and
exits non-zero otherwise.

**Alternative rejected: migrating on boot.** One less deploy step, and it makes every instance
a writer during a rolling restart, turns a failed migration into a crash loop, and makes the
order of two pods a factor in whether the schema is correct.

### Decision 7: Audit is buffered and lossy by design

Records are buffered in memory and flushed periodically; loss on restart is counted, not
prevented.

**Alternative rejected: writing audit synchronously with the answer.** It guarantees the
record. It also adds a round-trip to every response and makes the database an availability
dependency of ranking, which Decision 2 spent effort removing.

### Decision 8: Both catalogue adapters pass one contract suite

The file adapter and the database adapter are checked by the same tests, as the weather sources
are.

**Alternative rejected: treating the file adapter as a test fixture rather than a real
implementation.** It is less work. It also means the path used in development is not the path
used in production, and the two would drift in exactly the way the shared suite for weather
sources exists to prevent.

## Risks / Trade-offs

- **Two sources of rules — files and tables — can disagree.** Mitigation: publication is
  idempotent by code and version and fails on a checksum mismatch for an already-published
  version, so divergence is caught by the deploy rather than by a wrong answer.
- **A computed identifier merges genuinely distinct nearby places.** Accepted, and already
  accepted by `location-applicability` for the same reason: the source's grid is coarser than
  the rounding, so the merged places would receive identical data anyway.
- **PostgreSQL in the test path is slow if used carelessly.** Mitigation: unit tests use the
  file adapter and need no container; the database adapter is exercised by integration tests
  against a real PostgreSQL, because a substitute engine would prove nothing about migrations.
- **A degradation table is a promise that must be tested, not documented.** Mitigation: each
  row of it is a scenario below, exercised by disconnecting the store rather than by mocking a
  failure.
- **Audit that may be lost is audit that cannot be relied on for billing or compliance.**
  Accepted: its purpose is weight calibration and incident review, and the loss rate is a
  metric.

## Open Questions

- Whether the place-lookup table belongs here or in a shared cache once Redis exists. It is a
  cache by nature and needs to outlive a restart; stage 6 §12.2 leaves it here for now.
- Whether the applicability rules version is one number for all rules or one per rule. One
  number over-invalidates; one per rule is easy to forget to raise. Starting with one, as with
  the mapping version (`data-model.md` §12.4).
- Whether snow-season evidence deserves its own table rather than a field inside the profile.
  It is the only evidence gathered by a separate call and able to age separately
  (`data-model.md` §12.5).
- Audit sampling and partition granularity, both deliberately left to the first real
  measurement.
