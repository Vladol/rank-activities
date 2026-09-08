## Purpose

The live Open-Meteo implementation of the source seams: what the adapter must guarantee so
that everything behind the ports can stay ignorant of the vendor — units proven rather than
assumed, a body classified before it is parsed, provenance taken from the answer, failures
mapped onto the shared codes, and fixtures that are recorded from real traffic and checked
against it on a schedule.

## Requirements

### Requirement: The live source is admitted by the same contract as any other

The Open-Meteo source SHALL implement the forecast, marine and archive capability ports and
the place-lookup port, SHALL be selectable by explicit configuration, and SHALL pass the
shared source conformance suite without amendment to that suite.

#### Scenario: The live source passes the suite that admits the recorded source

- **WHEN** the conformance suite is run against the Open-Meteo source
- **THEN** it passes every case it passes for the recorded source
- **AND** no case in the suite is skipped, relaxed or specialised for this vendor

#### Scenario: The live source is bound only when it is chosen

- **WHEN** the service starts with the live source selected
- **THEN** the live source is bound for every capability it declares
- **AND** the startup log names the bound source per capability

#### Scenario: A capability the vendor does not serve is not silently bound

- **WHEN** a capability is requested for which the vendor declares no support
- **THEN** the service refuses to start rather than binding a source that will fail at
  request time

### Requirement: A response is classified before it is parsed

The source SHALL determine from the status, the content type and the presence of a body
what kind of response it holds, and SHALL NOT attempt to parse a body that failed any of
those checks.

#### Scenario: An HTML error page never reaches the parser

- **WHEN** the source responds `403` with an HTML body
- **THEN** the failure is typed as an unexpected content type
- **AND** no parse is attempted and no exception escapes the adapter

#### Scenario: An empty body with a success status is a failure

- **WHEN** the source responds `200` with a zero-byte body
- **THEN** the failure is typed as an empty response
- **AND** it is distinguishable from a malformed body and from a schema mismatch

#### Scenario: A structured API error is recognised as one

- **WHEN** the source responds `400` with a JSON body carrying its own error field
- **THEN** the failure is typed by our own code set, chosen from the status and the request
  we made
- **AND** the source's own explanatory text appears only in the log record

#### Scenario: A well-formed body that does not match the schema is a schema failure

- **WHEN** a parsed body omits a field the schema requires or carries an unexpected shape
- **THEN** the failure names the field that did not match
- **AND** it is reported as a validation failure, not as a transport failure

### Requirement: Units are asserted, never requested

The source SHALL NOT send any parameter that selects a unit system, and SHALL validate every
unit field the response declares against the unit its metric is defined in.

#### Scenario: No unit parameter is ever sent

- **WHEN** any outbound request is built
- **THEN** it carries no temperature, wind-speed or precipitation unit parameter

#### Scenario: A unit the response declares differently is refused

- **WHEN** a response declares a unit that differs from the one the metric dictionary
  expects for that variable
- **THEN** the response is rejected as a validation failure naming the variable and both
  units
- **AND** no value from that response is mapped, converted or scored

#### Scenario: The declared units are checked even when the values look plausible

- **WHEN** a response carries temperatures that are valid numbers in either scale
- **THEN** the decision is taken from the declared unit field alone
- **AND** no heuristic on the value range is used to guess the unit

### Requirement: The vendor's vocabulary does not leave its package

The names of the source's own variables, endpoints and parameters SHALL appear only inside
the vendor package, and every value that leaves it SHALL be expressed in the service's own
metric codes and canonical units.

#### Scenario: A vendor variable name outside the adapter is a defect

- **WHEN** the codebase is searched for the source's variable names outside the vendor
  adapters
- **THEN** there are no occurrences
- **AND** the check is executed by the test suite rather than left to review

#### Scenario: Adding a metric touches the vendor package and the dictionary only

- **WHEN** a metric the service did not previously fetch is added
- **THEN** the change is confined to the metric dictionary and the vendor package's variable
  map, schema and mapper
- **AND** no domain, scoring, ranking or API code changes

### Requirement: Provenance is taken from the answer, not from the question

Every series the source returns SHALL carry the coordinates and elevation the response
reports, the source's identity, the capability that served it, and the time we obtained it.

#### Scenario: The answered grid point is reported

- **WHEN** a response reports coordinates that differ from the requested ones
- **THEN** the series carries the reported coordinates
- **AND** the requested coordinates do not appear in the provenance

#### Scenario: The elevation of the answered point travels with the series

- **WHEN** a forecast response reports the elevation of its grid point
- **THEN** that elevation is carried with the series

#### Scenario: The time of retrieval is recorded at retrieval

- **WHEN** a series is produced from a live response
- **THEN** it carries the moment the response was received
- **AND** that moment is not re-derived later from when the series was read

### Requirement: Rate limiting is recognised without reading the body

The source SHALL recognise a rate-limited response from its status alone, SHALL take any
delay it observes from the standard retry header, and SHALL NOT parse the body of such a
response.

#### Scenario: A limited response is typed from its status

- **WHEN** the source responds with the rate-limit status
- **THEN** the failure is typed as a rate-limit failure
- **AND** the body is neither parsed nor validated

#### Scenario: A stated delay is preserved for the caller

- **WHEN** a rate-limited response carries a retry-after header
- **THEN** the delay it states travels with the failure
- **AND** a response without that header yields the same failure without a delay

### Requirement: The transport reuses connections and accepts compression

The source SHALL reuse connections across requests, SHALL receive compressed responses, and
SHALL apply a bounded timeout to each attempt independently of any surrounding policy.

#### Scenario: A second call to the same host does not re-establish the connection

- **WHEN** two requests are made to the same host in sequence
- **THEN** the second reuses the established connection

#### Scenario: Compression is in effect, not merely requested

- **WHEN** a response is received for a full-horizon hourly request
- **THEN** the response was transferred compressed
- **AND** the decoded body is what the schema validates

#### Scenario: An unresponsive host fails within the configured time

- **WHEN** a host accepts the connection and never responds
- **THEN** the attempt fails with a timeout failure within the configured bound
- **AND** the bound applies to the attempt, not to a chain of attempts

### Requirement: Recording a fixture is a by-product of a real request

The service SHALL offer a recording mode that serves requests from the live source and
writes each raw response, the request that produced it and its manifest entry, using the
same code path that serves a normal live request.

#### Scenario: A recorded fixture comes from the serving path

- **WHEN** the service runs in recording mode and a request is served
- **THEN** the response is returned to the caller as usual
- **AND** the raw body, the request URL and the moment of recording are written as a fixture

#### Scenario: Recording is never the default

- **WHEN** no source is explicitly configured
- **THEN** the recording mode is not selected
- **AND** selecting it requires an explicit configuration value

#### Scenario: An existing fixture is not overwritten silently

- **WHEN** a recording would replace a fixture that already exists
- **THEN** the write is refused unless replacement was explicitly requested
- **AND** the refusal names the fixture and the request that would have replaced it

### Requirement: A scheduled test proves the fixtures still describe the live API

The service SHALL carry a test that validates a live response with the same schema the
adapter uses, SHALL run it outside the default test run, and SHALL fail it in a way that
names the field that changed.

#### Scenario: The default test run touches no network

- **WHEN** the unit and end-to-end suites are run
- **THEN** the live contract test does not execute
- **AND** no outbound connection is made by the run

#### Scenario: A vendor change is reported as a fixture problem

- **WHEN** the live contract test runs and the live response no longer matches the schema
- **THEN** the failure names the variable or field that diverged
- **AND** the report states that the recorded fixtures and the mapper need updating

#### Scenario: The scheduled run is cheap

- **WHEN** the live contract test runs
- **THEN** it makes a bounded, small number of outbound requests sufficient to validate each
  capability's envelope
