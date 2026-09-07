## Purpose

One contract through which every external weather, marine and archive source is reached,
so that a source can be replaced, added or combined without touching the domain, and so
that every source delivers values in the same canonical units with the same
missing-value and failure semantics.

## ADDED Requirements

### Requirement: Sources are reached through capability ports

The service SHALL reach external time-series data only through a port per capability
(forecast, marine, archive). Each bound source SHALL declare its capability and the
metrics it supports, and SHALL NOT be asked for a metric it does not declare.

#### Scenario: A metric is requested from the capability that serves it

- **WHEN** a request needs wave height and air temperature
- **THEN** wave height is requested from the marine capability and air temperature from
  the forecast capability
- **AND** each call carries only the metrics belonging to that capability

#### Scenario: An unsupported metric is an explicit error

- **WHEN** a metric is requested that no bound source declares support for
- **THEN** the service reports an error naming the metric and the capability it belongs to
- **AND** it does NOT return an empty series, a zero-filled series, or a silently
  shortened metric list

#### Scenario: Capabilities can be served by different sources

- **WHEN** the forecast capability is bound to one source and the marine capability to
  another
- **THEN** both are requested independently and their series are combined into one
- **AND** the combined series records which source each metric came from

### Requirement: Every value crosses the port in its canonical unit

The service SHALL define exactly one canonical unit per metric, and every value leaving a
source port SHALL be expressed in it. Unit conversion SHALL happen only while mapping a
source's raw response, and no source-specific unit SHALL exist beyond that point.

#### Scenario: Wind is converted, snow is not

- **WHEN** a source returns `wind_speed_10m` in km/h, `snow_depth` in metres and
  `snowfall` in centimetres
- **THEN** wind speed crosses the port in m/s
- **AND** snow depth crosses the port in metres and snowfall in centimetres, matching
  their canonical units
- **AND** visibility crosses the port in kilometres, not metres

#### Scenario: A unit the source did not promise is rejected

- **WHEN** a source's response declares a unit that differs from the expected one for
  that metric — for example temperature in °F
- **THEN** the response is rejected as invalid
- **AND** the failure names the metric, the expected unit and the received one
- **AND** no value from that response reaches the domain

#### Scenario: Every metric declares its canonical unit

- **WHEN** a metric is added to the metric dictionary without a canonical unit,
  granularity and serving capability
- **THEN** the service fails to start

### Requirement: A missing value stays missing

A `null` inside a source's series is normal data, not an incident. The service SHALL
carry absence across the port as absence, and SHALL NOT substitute zero, the previous
value, an interpolation or a default.

#### Scenario: Gaps inside a series survive the crossing

- **WHEN** a source returns an hourly series with `null` in some slots
- **THEN** the series crossing the port has the same length
- **AND** the same slots are absent, and no slot has been filled in

#### Scenario: An entirely null series is present, not missing

- **WHEN** a marine source answers with a complete time grid in which every value is null
- **THEN** the port returns a series that exists and contains no values
- **AND** this is distinguishable from "no series was returned" and from a transport
  failure

### Requirement: Data carries its own provenance

Every series crossing a port SHALL carry, per source that contributed to it, the source
identifier, the grid point the source actually answered for together with that point's
elevation, the time the data was obtained, and whether it is stale.

#### Scenario: The answered grid point is reported, not the requested one

- **WHEN** a forecast is requested for `38.7167, -9.1333` and the source answers for its
  grid node `38.75, -9.125`
- **THEN** the series reports the grid point from the response
- **AND** the requested coordinates are not presented as the coordinates of the forecast

#### Scenario: A combined series records both origins

- **WHEN** a series combines forecast metrics obtained at 10:00 with marine metrics
  obtained at 07:00
- **THEN** the series carries both provenance entries with their own timestamps

#### Scenario: The elevation of the answered grid point travels with the series

- **WHEN** a source reports the elevation of the grid node it answered for
- **THEN** the series carries that elevation
- **AND** a metric derived from it is computed without consulting any location record

### Requirement: Failures are returned as values, not thrown

Every port SHALL return a typed result and SHALL NOT throw for any failure originating
outside the process. Each failure SHALL be mapped to a stable error code from a fixed
set, independent of the source that produced it.

#### Scenario: A malformed body is a typed failure

- **WHEN** a source answers HTTP 200 with an empty body
- **THEN** the port returns a failure with a stable code
- **AND** no parse exception escapes the adapter

#### Scenario: A non-JSON body is detected before parsing

- **WHEN** a source answers HTTP 403 with an HTML body
- **THEN** the content type is checked before the body is parsed
- **AND** the port returns a failure naming the unexpected content type

#### Scenario: The source's own error text is never returned

- **WHEN** a source answers HTTP 400 with an error message of its own — including a
  factually wrong one, or one containing internal type names
- **THEN** the port returns the mapped error code
- **AND** the source's text appears in the logs only, never in the service's response

#### Scenario: An unresponsive source fails within a bounded time

- **WHEN** a source does not answer within the configured timeout
- **THEN** the port returns a timeout failure
- **AND** the wait is bounded per attempt rather than by the caller giving up

### Requirement: The active source is chosen explicitly and never substituted

The service SHALL select the source for each capability from configuration at startup,
SHALL report the selection, and SHALL refuse to start when a configured value names a
source that is not implemented. A source SHALL NEVER stand in silently for another.

#### Scenario: The selection is visible at startup

- **WHEN** the service starts
- **THEN** the startup log states, per capability, which source is bound

#### Scenario: An unimplemented source refuses the start

- **WHEN** configuration names a source that exists as a declared option but has no
  implementation
- **THEN** the process exits with a non-zero code and a message naming it as not
  implemented
- **AND** the service does NOT fall back to another source

### Requirement: Place lookup is reached through its own port

The service SHALL reach place lookup through a port separate from the time-series ports,
under the same failure rules: a typed result rather than an exception, a validated
response, and no propagation of the source's own error text. A successful response
carrying no matches SHALL be a valid empty result, not a failure.

#### Scenario: A lookup returns the source's candidates

- **WHEN** a place name is looked up
- **THEN** the port returns the candidates the source offers, each with coordinates, time
  zone, elevation and population
- **AND** choosing among the candidates is not the port's concern

#### Scenario: No matches is an empty result, not a failure

- **WHEN** the lookup source answers successfully with a body that carries no matches at
  all
- **THEN** the port returns an empty result
- **AND** it does not report a transport, parse or schema failure

#### Scenario: A lookup failure is typed like any other

- **WHEN** the lookup source is unavailable or answers with an unexpected content type
- **THEN** the port returns a typed failure from the same code set as the series ports
- **AND** the source's own error text is not returned

### Requirement: Only planned metrics are fetched

The service SHALL derive the set of metrics to request from the activities that are
applicable to the location, and SHALL make no call to a capability whose metrics no
applicable activity needs.

#### Scenario: An inland location makes no marine call

- **WHEN** a ranking is computed for a location where surfing is not applicable
- **THEN** no marine request is made at all
- **AND** the forecast request carries only the metrics the remaining activities declare

#### Scenario: Metrics needed by several activities are requested once

- **WHEN** three applicable activities all declare air temperature
- **THEN** temperature appears once in the request

#### Scenario: A derived metric is requested as its inputs

- **WHEN** an activity declares a metric that is computed from other metrics
- **THEN** the request carries the underlying metrics
- **AND** the derived value is computed after the series is retrieved, not requested from
  the source

### Requirement: A request is validated before it leaves the process

The service SHALL reject a request that violates a source's declared limits before
issuing it, using its own error codes rather than the source's response.

#### Scenario: An over-long horizon never reaches the source

- **WHEN** a series is requested for a horizon longer than the source declares it supports
- **THEN** the request fails locally with the service's own horizon error
- **AND** no outbound call is made

### Requirement: Every source implementation satisfies the same contract suite

Each adapter SHALL be verified by one shared conformance suite before it is bound, and a
new source SHALL NOT require changes to the domain, the scoring, the API or the storage.

#### Scenario: A new source is admitted by the suite

- **WHEN** a new adapter for the forecast capability is added
- **THEN** it is exercised by the same conformance suite as every other forecast source
- **AND** it is bound only once that suite passes

#### Scenario: The suite covers the contract, not one vendor

- **WHEN** the conformance suite runs against any forecast source
- **THEN** it asserts canonical units, honest `supports`, preserved gaps, provenance from
  the response, and typed failures rather than throws
