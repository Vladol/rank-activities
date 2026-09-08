## Purpose

The end-to-end scenario the service exists for: from a location and a horizon to an
ordered, explained and accountable answer for each day — where every activity's outcome
states honestly which kind of answer it is, and one failing source costs one activity
rather than the whole result.

## Requirements

### Requirement: A ranking request names a location and a horizon

The service SHALL accept a location and a number of days, SHALL validate the horizon
against the supported range before performing any outbound work, and SHALL reject an
out-of-range horizon rather than shortening it.

#### Scenario: A horizon within range is honoured

- **WHEN** a ranking is requested for a supported number of days
- **THEN** the answer covers exactly that many days

#### Scenario: An excessive horizon is rejected, not truncated

- **WHEN** a ranking is requested for more days than the service supports
- **THEN** the request fails with the horizon reason
- **AND** no partial answer covering fewer days is returned
- **AND** no outbound data request is made

#### Scenario: An omitted horizon uses the configured default

- **WHEN** no horizon is given
- **THEN** the configured default horizon is used
- **AND** the answer states how many days it covers

### Requirement: A day is the location's own local date

The service SHALL identify each day by the local date of the location, and SHALL report
the location's time zone with the answer.

#### Scenario: Days are labelled by local date

- **WHEN** an answer covers several days
- **THEN** each day is identified by a local calendar date rather than by an offset from
  the moment of the request

#### Scenario: A far-offset location does not shift by a day

- **WHEN** a ranking is requested for a location whose local date differs from the
  requester's
- **THEN** the days are those of the location
- **AND** the answer carries the location's time zone

#### Scenario: Each day declares whether it is complete

- **WHEN** an answer covers a day
- **THEN** that day declares whether it was computed from a complete local day
- **AND** the declaration reflects what was actually computed

### Requirement: Every activity yields exactly one of three outcomes per day

For each day, every activity in the catalogue SHALL be reported as exactly one of: a
ranked result with a score, an inapplicable result, or a missing-data result. No activity
SHALL be silently omitted.

#### Scenario: All catalogue activities are accounted for

- **WHEN** an answer is produced for a day
- **THEN** every activity in the catalogue appears exactly once in that day's results

#### Scenario: The four distinguishable answers

- **WHEN** the same activity is evaluated at a location where it is impossible, at a
  location where conditions are absent today, at a location with good conditions, and at a
  location whose data source is unavailable
- **THEN** the four answers are distinguishable from one another: inapplicable, a ranked
  zero with a constraint, a ranked positive score, and missing data

### Requirement: Every reason the service reports comes from one registry

The service SHALL draw every reason it reports — inapplicability, a violated constraint,
missing data and a rejected request — from a single declared registry of reason codes, and
SHALL NOT report a reason that is not in it. Human-readable text SHALL be derived from the
code, and the code SHALL NOT be derived from the text.

#### Scenario: A reason absent from the registry cannot be reported

- **WHEN** any result carries a reason
- **THEN** that reason is one of the declared codes
- **AND** no free-form string is returned in place of a code

#### Scenario: A new reason is declared once

- **WHEN** a new reason code is added to the registry
- **THEN** it becomes available everywhere reasons are exposed, described or stored,
  without being listed a second time somewhere else

#### Scenario: Text follows the code

- **WHEN** a reason is presented to a client
- **THEN** its human-readable text is resolved from the code
- **AND** the same code yields the same meaning in every result that carries it

### Requirement: An inapplicable activity states why, and carries no score

An inapplicable result SHALL carry a machine-readable reason and a message suitable for
localisation, and SHALL NOT carry a score of any value.

#### Scenario: Geography is reported as geography

- **WHEN** an activity is impossible at a location for geographical reasons
- **THEN** the result is inapplicable with the corresponding reason code
- **AND** it carries no score

#### Scenario: The reason is a code, and the text is separate

- **WHEN** an inapplicable result is produced
- **THEN** the reason is a stable code from the service's reason registry
- **AND** any human-readable text is derived from that code rather than being the identity
  of the reason

### Requirement: A ranked zero states the constraint it violated

A ranked result whose score is zero SHALL carry the reason code of the constraint that
zeroed it, and SHALL remain distinct from an inapplicable result.

#### Scenario: Today's conditions are absent, but the activity exists here

- **WHEN** an activity is possible at a location but a hard constraint is violated on a day
- **THEN** the result is a ranked score of zero carrying that constraint's reason
- **AND** it is not reported as inapplicable

#### Scenario: A cross-cutting constraint applies to every activity

- **WHEN** conditions violate a constraint that every activity includes
- **THEN** every activity for that day is a ranked zero carrying that reason, indoor
  activities included

#### Scenario: A constraint an activity does not include leaves it scored

- **WHEN** conditions violate a constraint that the outdoor activities include and an
  indoor activity does not — a day with no daylight at all
- **THEN** the outdoor activities are ranked zeroes carrying that reason
- **AND** the indoor activity is ranked on its own merits and outranks them
- **AND** no score in that day's answer is non-numeric

### Requirement: Missing data states what is missing and whether to retry

A missing-data result SHALL carry a machine-readable reason, the metrics that could not be
obtained, and whether retrying may succeed.

#### Scenario: An unavailable source is reported as retryable

- **WHEN** a source needed by an activity is unavailable
- **THEN** that activity reports missing data with a retryable indication

#### Scenario: An unusable day is reported as such

- **WHEN** a day's series has too many gaps to score honestly
- **THEN** that day's affected activities report missing data with the corresponding reason
- **AND** the remaining days of the same answer are unaffected

### Requirement: A ranked result carries its explanation

A ranked result SHALL carry, per feature that took part, the metric, the aggregated raw
value with its unit, the normalised value, and either the weight applied or the factor a
limiting feature imposed — sufficient to show why the score is what it is without a second
request. A feature that was dropped for want of data SHALL appear as dropped rather than be
omitted.

#### Scenario: The explanation accompanies the score

- **WHEN** an activity is ranked for a day
- **THEN** the result carries the features that took part with their raw values, units,
  normalised values, and their weights or limiting factors

#### Scenario: A feature that could not be used is still visible

- **WHEN** a feature was dropped or treated as neutral because its metric had no value
- **THEN** the explanation says so for that feature
- **AND** a client can tell a low contribution apart from an absent one

### Requirement: Ordering is defined and deterministic

Within a day the service SHALL order ranked results by descending score, SHALL break ties
deterministically, and SHALL exclude inapplicable and missing-data results from that
ordering, grouping them separately.

#### Scenario: Ranked results are ordered by score

- **WHEN** a day holds several ranked results
- **THEN** they appear in descending order of score

#### Scenario: Ties are broken the same way every time

- **WHEN** two activities score equally on a day
- **THEN** their relative order is the same on every evaluation of the same input

#### Scenario: Non-scored outcomes are not ranked

- **WHEN** a day holds inapplicable or missing-data results
- **THEN** they do not participate in the score ordering
- **AND** they are grouped separately from the ranked results

### Requirement: An answer is accountable

The service SHALL return, with every answer, the resolved location, when the underlying
data was obtained, whether it is stale, the scoring profile version applied, and the
location's time zone.

#### Scenario: The answer states which place it is about

- **WHEN** a location was resolved from a name
- **THEN** the answer identifies the resolved place, including country and region

#### Scenario: Stale data is delivered as stale, not as an error

- **WHEN** fresh data cannot be obtained but data previously obtained is available
- **THEN** the answer is produced from that data, marked stale, with the time it was
  obtained
- **AND** the request does not fail

#### Scenario: The answer states the rules it was computed under

- **WHEN** an answer is produced
- **THEN** it carries the scoring profile version applied

### Requirement: A failure affecting one activity does not cancel the others

The service SHALL contain a data failure to the activities that depend on the failed data,
and SHALL produce results for all other activities.

#### Scenario: One unavailable source costs one activity

- **WHEN** the source serving one activity's metrics is unavailable while the others
  respond
- **THEN** that activity reports missing data
- **AND** the remaining activities are ranked normally on the same day

#### Scenario: A resolvable location with no usable data still answers per activity

- **WHEN** every weather source is unavailable and nothing usable is cached
- **THEN** each activity reports missing data with a retryable indication
- **AND** the answer still identifies the resolved location and its time zone

### Requirement: The same input produces the same answer

Given the same request and the same underlying data, the service SHALL produce the same
scores, the same outcomes and the same ordering.

#### Scenario: Repeating a request repeats the answer

- **WHEN** the same ranking request is evaluated twice against unchanged data
- **THEN** the scores, the reason codes and the ordering are identical

### Requirement: The answer states the limits of what it judged

The service SHALL return a statement of scope declaring that the ranking reflects weather
conditions only.

#### Scenario: A high score is not an authorisation

- **WHEN** an answer is produced
- **THEN** it carries a scope statement that the ranking is based on weather and does not
  account for hazards, operations or access conditions
