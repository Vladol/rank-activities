# data-persistence Specification

## Purpose

What the service must keep, what it must refuse to keep, and how it behaves when the store is
gone: durable evidence and identity, published rule versions that stay reproducible, a probe
history that lets a two-phase decision terminate, migration discipline, audit that costs the
answer nothing, and a named degradation rather than a blanket failure.

## Requirements

### Requirement: What is stored is decided by the cost of losing it

The service SHALL store durably the data whose loss would require repeating outbound calls or
would make a past computation irreproducible, and SHALL NOT store weather series of any
granularity.

#### Scenario: Evidence and identity survive a restart

- **WHEN** the service is restarted after having resolved a location and computed its profile
- **THEN** the location, its profile and the evidence behind it are available without any
  outbound call
- **AND** the profile is not recomputed

#### Scenario: Series are not written to the durable store

- **WHEN** weather data is obtained from any capability
- **THEN** no hourly or daily series is written to the durable store
- **AND** the durable store holds only the conclusions drawn from such data

#### Scenario: Losing volatile data costs one call, not a decision

- **WHEN** the service is restarted and a known location is ranked again
- **THEN** the series are obtained again from the source or the cache
- **AND** no applicability decision is repeated as a result

### Requirement: A location's identity is computed, not issued

The service SHALL derive a location's identifier deterministically from its rounded
coordinates, without consulting the store, and SHALL yield the same identifier for the same
place in every process and every run.

#### Scenario: The identifier exists before the row does

- **WHEN** a location is resolved for the first time
- **THEN** its identifier is known before anything is written
- **AND** the identifier does not depend on insertion order

#### Scenario: Two deployments agree on identity

- **WHEN** the same place is resolved by two independent instances with separate stores
- **THEN** both produce the same identifier

### Requirement: Probe history is durable and bounded to one probe per day

The service SHALL record each applicability probe against its location and its local date,
SHALL make a second probe for the same location on the same local date impossible, and SHALL
retain the history across restarts.

#### Scenario: Yesterday's probe is still there today

- **WHEN** a probe is recorded, the service restarts, and the location is requested on a later
  local date
- **THEN** the earlier probe is still recorded
- **AND** a probe on the later date can confirm the earlier finding

#### Scenario: The same day cannot be probed twice

- **WHEN** two concurrent requests would both probe the same location on the same local date
- **THEN** at most one probe is recorded
- **AND** the second request uses the recorded result

#### Scenario: A two-phase decision terminates

- **WHEN** two probes on different local dates both report no coverage
- **THEN** the profile records the activity as impossible at that location
- **AND** the decision survives a restart

### Requirement: A published version of the rules is immutable and idempotently published

The service SHALL publish rule and profile versions by code and version, SHALL leave an
existing published version unchanged when publication runs again, and SHALL fail publication
when the content of an already-published version differs from what is being published.

#### Scenario: Publishing twice changes nothing

- **WHEN** publication runs a second time with unchanged content
- **THEN** no published version is modified
- **AND** the operation succeeds

#### Scenario: Rewriting a published version fails the deploy

- **WHEN** publication runs with content that differs from an already-published version under
  the same code and version
- **THEN** publication fails and names the version and the difference
- **AND** the stored version is left as it was

#### Scenario: A past result stays explicable

- **WHEN** a computation recorded a rule version and a newer version is later published
- **THEN** the recorded version is still retrievable and still describes what it described

### Requirement: The service loads its rules without the store

The service SHALL treat the repository as the source of truth for declarations and profiles,
SHALL be able to load, validate and apply them with no store available, and SHALL check both
implementations of the catalogue against one shared contract suite.

#### Scenario: Ranking a known location with no store present

- **WHEN** the store is unreachable and a location whose profile is already known is ranked
- **THEN** the answer is produced from rules in memory and data from the cache
- **AND** the request does not fail

#### Scenario: Both catalogue implementations behave identically

- **WHEN** the shared catalogue contract suite is run against the file-backed and the
  store-backed implementations
- **THEN** both pass it unchanged

#### Scenario: The whole test suite needs no store

- **WHEN** the unit and end-to-end suites are run
- **THEN** they pass with no database available
- **AND** integration tests that require one are separate and are the only ones that start it

### Requirement: The service never migrates itself and refuses an unexpected schema

The service SHALL NOT alter the schema at startup, SHALL verify at startup that the schema is
the one it expects, and SHALL exit with a non-zero status when it is not.

#### Scenario: A schema behind the code stops the start

- **WHEN** the service starts against a store whose schema is not the expected one
- **THEN** it exits non-zero naming the expected and the found state
- **AND** it serves no request

#### Scenario: Starting does not change the schema

- **WHEN** the service starts against a correct schema
- **THEN** no schema change is performed
- **AND** starting several instances concurrently performs no schema change either

#### Scenario: Reference data arrives by publication, not by migration

- **WHEN** declarations, profiles or reference registries change
- **THEN** they are published as data
- **AND** no schema migration is required to change them

### Requirement: Invariants expressible in the store are enforced by the store

The service SHALL enforce in the store itself those invariants the store can express, rather
than relying on application code alone.

#### Scenario: A reason that is not a registered code cannot be stored

- **WHEN** a record would carry a reason absent from the reason registry
- **THEN** the store rejects it

#### Scenario: A score exists exactly when the outcome is a ranked one

- **WHEN** a record would carry a score for a non-ranked outcome, or a ranked outcome with no
  score
- **THEN** the store rejects it

#### Scenario: A negative lookup cannot masquerade as a positive one

- **WHEN** a lookup record would claim a result was found while carrying no result
- **THEN** the store rejects it

#### Scenario: An undecided conclusion is distinguishable from a negative one

- **WHEN** applicability evidence has not been gathered yet
- **THEN** the stored state is distinguishable from evidence that was gathered and was negative

### Requirement: Audit is recorded off the hot path and may be lost

The service SHALL record the inputs and outcome of a computation without adding latency to the
answer, SHALL tolerate losing buffered records, and SHALL count what it loses.

#### Scenario: Answering does not wait for the audit

- **WHEN** a ranking is answered
- **THEN** the answer is returned without waiting for any audit write
- **AND** the audit record is written afterwards

#### Scenario: Losing audit costs records, not answers

- **WHEN** the store is unavailable or the service restarts with a non-empty buffer
- **THEN** answers continue to be produced
- **AND** the number of lost records is exposed as a metric

#### Scenario: The audit holds aggregates, not series

- **WHEN** an audit record is written
- **THEN** it carries the aggregated feature values that produced the score
- **AND** it does not carry the hourly series they were derived from

### Requirement: An unavailable store degrades named capabilities only

When the store cannot be reached, the service SHALL continue to serve what does not require it,
SHALL refuse with a reason what does, and SHALL report itself as not ready.

#### Scenario: A known location still ranks

- **WHEN** the store is unavailable and a location with a known profile is ranked
- **THEN** the answer is produced
- **AND** it is not marked as an error

#### Scenario: A new location is refused with a reason

- **WHEN** the store is unavailable and a location with no known profile is requested
- **THEN** the request is refused with a reason code stating the profile is unavailable
- **AND** the refusal is distinguishable from a location that could not be resolved

#### Scenario: Readiness reflects the store

- **WHEN** the store is unavailable or its schema is not the expected one
- **THEN** the readiness check reports not ready
- **AND** liveness is unaffected by the availability of the source of weather data
