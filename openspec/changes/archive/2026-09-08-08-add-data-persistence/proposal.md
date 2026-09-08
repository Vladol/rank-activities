## Why

The assignment asks the service to persist weather data rather than call the API on every
request, and says explicitly that *how you model and store it is part of the problem*.
`07-add-source-caching-and-resilience` answered the "call it less" half. This change answers
the "model and store it" half, and it is the last one where the answer is still only a
document: `docs/investigation/data-model.md` is a complete schema — DDL, indexes, JSONB
payloads, growth estimates — with not a single requirement attached to it. A schema nobody
is required to honour is a drawing.

There is also a defect to repair, and it is not cosmetic. `location-applicability` requires
that a no-coastline decision be confirmed by **a second probe on a different day**, and the
same change defers its profile store to an in-memory implementation "until stage 6", recording
the cost as "an extra missing-data answer for one location, and one extra probe". That
understates it: with nothing durable, a process that restarts more often than once a day can
*never* reach the second day with the first probe still recorded. The confirmation state
machine has no reachable terminal state, so surfing at an inland location stays missing-data
forever rather than becoming inapplicable. This change is what makes that requirement
satisfiable, exactly as `07` is what makes the stale-answer requirement satisfiable.

The rule that decides what goes where was settled in stage 6 and stated in `data-model.md` §0
as one question — *what happens if this disappears?*:

- reproducing a past computation becomes impossible → durable, append-only;
- re-gathering it costs several outbound calls and a day of waiting → durable;
- one 136 ms call restores it completely → cache only;
- it is derived from the declarations → process memory.

Applied honestly, that rule produces a schema with **no hourly series in it at all**. A
forecast table would be a second, worse copy of Open-Meteo: stale within the hour, and
restorable by one request. What reaches the database from the source is conclusions —
a boolean snow season instead of 31 days of archive, a coverage verdict instead of a marine
series.

## What Changes

- **A durable store for what is expensive to re-derive**: resolved locations, their
  applicability profiles with the evidence behind them, marine probe state, the place-lookup
  results with their long lifetime, and the published versions of rules and profiles.
- **Location identity is computed, not issued.** The identifier is derived from the rounded
  coordinates, so the same city yields the same identifier before any database is consulted,
  and across machines that never shared one.
- **At most one probe per location per day, enforced by the store**, not by a service that
  remembers to check — which is what turns the two-phase confirmation from an intention into
  a state machine that terminates.
- **The repository stays the source of truth for rules; the database is where versions are
  published and kept.** The catalogue sits behind a port with two implementations — files and
  the database — and both pass the same contract suite, so the service starts, loads its
  rules and ranks a known location with no database present.
- **Publishing is idempotent by code and version, and refuses to alter a published version.**
  A changed definition under a version that already exists fails the deploy rather than
  silently rewriting history that audit records point at.
- **The service never migrates itself.** Migration is a deploy step; at startup the service
  verifies the schema is the one it expects and exits non-zero if it is not.
- **Invariants that can be expressed in the schema are expressed there** — a published version
  is immutable, a reason is a code from the registry, a score exists exactly when the outcome
  is ranked, a negative lookup cannot pretend to be a positive one.
- **Computation audit is written off the hot path**, buffered and flushed, and its loss costs
  records and a metric rather than latency or an answer.
- **Losing the database degrades the service by a stated table**, not by a blanket failure: a
  known location still ranks from rules in memory and data in cache; a new location is refused
  with a reason; readiness turns red.

**Out of scope, deliberately:**

- Storing weather series. Stated above and in `data-model.md` §10; the cache owns them.
- Redis. Still gated on a second instance (stage 6 §9.4). Whether the place-lookup table
  eventually moves there is left open in stage 6 §12.2.
- PostGIS and any coastline geometry. Applicability is decided by probing the wave model,
  which is why no spatial dependency is needed for one boolean.
- Personal scoring profiles and user accounts. The profile table is already versioned and the
  version already travels in the answer; the axis is open, the feature is not built.
- Audit sampling rules and partition sizing. Both need a first measurement rather than a
  guess (`data-model.md` §12).

## Capabilities

### New Capabilities

- `data-persistence`: what survives a restart and what deliberately does not — durable
  location and applicability state, probe history, published rule versions, computed identity,
  schema-and-migration discipline, audit off the hot path, and the named degradation when the
  store is unavailable.

### Modified Capabilities

None. `location-applicability` already requires durable, reusable profiles and a probe on a
different day; this change supplies the store that makes those statements true, without
restating them.

## Impact

| Area | Effect |
|---|---|
| `src/infrastructure/db/schema/` | Tables from `data-model.md` §2, with the invariants in DDL |
| `src/infrastructure/db/migrations/` | The six migrations of `data-model.md` §9, applied as a deploy step |
| `src/infrastructure/db/seed/` | Idempotent publication of declarations, profiles and reference data |
| `src/infrastructure/db/migration-guard.ts` | Schema check at startup, non-zero exit on mismatch |
| `src/modules/geo/` | Profile and probe stores move from in-memory to the durable adapter |
| `src/modules/activities/` | Catalogue port gains its database adapter beside the file one |
| `src/modules/ranking/` | Audit buffer and flush, off the hot path |
| `openspec/changes/04-add-location-applicability` | **Unblocks** its two-phase probe; see design.md Context |
| `openspec/changes/07-add-source-caching-and-resilience` | Prerequisite: the cache that keeps series out of this store |
| Dependencies | `drizzle-orm`, `drizzle-kit`, `pg`, `@testcontainers/postgresql` |
