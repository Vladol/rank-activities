## Purpose

The surface that carries the answer: a single bounded query, an outcome union that makes every
state explicit and none ignorable, a clear line between a failed request and a reported state,
containment of every internal detail, a generated schema that evolves additively, a bounded
endpoint, and health signals that mean what an orchestrator needs them to mean.

## ADDED Requirements

### Requirement: One query takes one location and a bounded horizon

The API SHALL expose ranking as a single query accepting exactly one location — a name or
coordinates — and an optional number of days, and SHALL express the supported range of days in
the contract itself.

#### Scenario: A location is given as a name or as coordinates

- **WHEN** a ranking is requested with a place name, or with coordinates
- **THEN** both are accepted by the same query
- **AND** a request providing neither, or both, is rejected as invalid

#### Scenario: The horizon's range is part of the contract

- **WHEN** the schema is inspected
- **THEN** the supported range of days is discoverable from the contract
- **AND** a request outside that range is rejected before any data is obtained

#### Scenario: The query takes exactly one location

- **WHEN** the schema is inspected
- **THEN** there is no way to express several locations in one request
- **AND** adding that ability later requires no change to the existing field

### Requirement: An activity result is a union, and no state can be ignored

The API SHALL represent each activity's result for a day as one of three distinct types — ranked,
inapplicable, missing data — SHALL place that union on the activity rather than on the answer, and
SHALL NOT express an outcome as a nullable field on a single type.

#### Scenario: Three types, not three nullable fields

- **WHEN** the schema is inspected
- **THEN** the activity result is a union of three types
- **AND** no type in it carries a nullable score standing in for another state

#### Scenario: A client cannot silently skip a state

- **WHEN** a client selects fields on the activity result without covering every member of the
  union
- **THEN** the query is rejected by the schema rather than answered with empty fields

#### Scenario: One failing activity does not change the shape of the answer

- **WHEN** one activity reports missing data while the others are ranked
- **THEN** the answer is a successful response
- **AND** the failing activity is one member of the union inside the same day

### Requirement: A ranked result carries its explanation in the response

The API SHALL expose, for each feature that took part in a ranked score, the metric, the
aggregated raw value with its unit, the normalised value, and the weight or limiting factor
applied — and SHALL expose features dropped for want of data as dropped.

#### Scenario: The explanation needs no second request

- **WHEN** a client selects the explanation alongside the score
- **THEN** it receives the raw values, units, normalised values and weights in the same response

#### Scenario: An absent contribution is distinguishable from a small one

- **WHEN** a feature was dropped or treated as neutral for want of data
- **THEN** the response marks it as such
- **AND** it is not represented as a contribution of zero

### Requirement: A failed request is an error; a reported state is data

The API SHALL carry request failures as transport errors bearing a code from the service's reason
registry and a trace identifier, and SHALL carry inapplicability, missing data and a ranked zero
as values within a successful response.

#### Scenario: An unresolvable location is an error

- **WHEN** the location cannot be resolved
- **THEN** the response carries an error with the corresponding registry code and a trace
  identifier
- **AND** no partial ranking answer is returned alongside it

#### Scenario: An impossible activity is not an error

- **WHEN** an activity is impossible at the resolved location
- **THEN** the response is successful
- **AND** the activity appears as the inapplicable member of the union with its reason code

#### Scenario: Every code the API emits comes from the registry

- **WHEN** any error or reason is returned
- **THEN** its code is one declared in the reason registry
- **AND** no free-form message stands in place of a code

### Requirement: Nothing internal crosses the boundary

The API SHALL NOT return the text of a source's error, the body of an invalid response, a stack
trace or any internal exception detail, and SHALL answer an unforeseen failure with a generic
code and a trace identifier that ties it to the log record.

#### Scenario: A source's own words stay in the log

- **WHEN** an outbound source fails with a message of its own
- **THEN** that message appears in the log record
- **AND** the response carries only a registry code and a trace identifier

#### Scenario: An unforeseen failure is still well-formed

- **WHEN** an unexpected exception occurs while answering
- **THEN** the response carries a generic internal code and a trace identifier
- **AND** it carries no stack trace, type name or message from the exception

#### Scenario: One identifier ties an answer to its record

- **WHEN** any response is produced
- **THEN** it carries a trace identifier
- **AND** the same identifier appears in the log records for that request

### Requirement: The published types are not the domain's types

The API SHALL define its own types and assemble them from domain values, so that renaming or
restructuring a domain type does not alter the published contract.

#### Scenario: A domain rename is not a contract change

- **WHEN** a domain type or field is renamed without changing meaning
- **THEN** the published schema is unchanged

#### Scenario: The core carries no transport concerns

- **WHEN** the pure core is inspected
- **THEN** it contains no API decorators, models or transport types

### Requirement: The schema is generated and evolves additively

The API's schema SHALL be generated from the code rather than maintained by hand, new fields
SHALL be optional, superseded fields SHALL be marked deprecated rather than removed, and a removal
SHALL be a deliberate, stated breaking change.

#### Scenario: The generated schema is not an editable artefact

- **WHEN** the service starts
- **THEN** the schema file is regenerated from the code
- **AND** a hand edit to it cannot survive or take effect

#### Scenario: Adding a field breaks no client

- **WHEN** a field is added to an existing type
- **THEN** it is optional
- **AND** an existing query continues to answer identically

#### Scenario: Removing a field is a decision, not a side effect

- **WHEN** a field is to be removed
- **THEN** it is first marked deprecated
- **AND** the removal is recorded as a breaking change with its reason

### Requirement: The endpoint is bounded against abuse

The API SHALL limit query depth, SHALL NOT accept several operations in one request, SHALL
disable schema introspection outside development, and SHALL limit the rate of inbound requests.

#### Scenario: An over-deep query is refused

- **WHEN** a query nests beyond the configured depth
- **THEN** it is rejected before execution

#### Scenario: Many operations cannot travel as one request

- **WHEN** a request carries a batch of operations
- **THEN** it is refused
- **AND** each operation must be sent as its own request to be counted and traced

#### Scenario: Introspection is unavailable in production

- **WHEN** the service runs in production and an introspection query is issued
- **THEN** it is refused

#### Scenario: A flood of distinct locations is limited at the door

- **WHEN** a single client issues requests faster than the configured inbound limit
- **THEN** the excess is refused with a rate-limit response
- **AND** the refusal happens before any outbound call is made

### Requirement: Liveness and readiness answer different questions

The service SHALL expose a liveness signal reporting only that the process is running, and a
readiness signal reporting whether it can serve — and the availability of a weather source SHALL
be part of neither.

#### Scenario: A source outage does not make the service unready

- **WHEN** every weather source is unavailable
- **THEN** the readiness signal still reports ready
- **AND** requests are answered with stale or missing-data results as the domain requires

#### Scenario: An unusable store makes the service unready

- **WHEN** the durable store is unreachable or its schema is not the expected one
- **THEN** the readiness signal reports not ready
- **AND** the liveness signal is unaffected

#### Scenario: The signals are separate endpoints

- **WHEN** the service is inspected
- **THEN** liveness and readiness are addressable independently
