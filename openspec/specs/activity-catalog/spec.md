# activity-catalog Specification

## Purpose
Activities expressed as versioned, validated declarations rather than code, so that
adding an activity or changing a rule is a data change with a reviewable history, and so
that a rule that must apply to every activity is stated once.

## Requirements

### Requirement: An activity is a declaration, not code

The service SHALL derive every activity it offers from a declaration. Adding an activity
SHALL require no change to service, engine, resolver or storage code.

#### Scenario: A new activity appears without a code change

- **WHEN** a valid declaration for a new activity is added to the catalogue
- **THEN** the activity is evaluated for every location where it is applicable and appears
  in results
- **AND** no application code was modified to make that happen

#### Scenario: The catalogue is the only source of activities

- **WHEN** the service starts
- **THEN** the set of activities it can rank equals the set of active declarations
- **AND** an activity absent from the catalogue is not produced by any other path

### Requirement: A declaration states everything needed to evaluate it

A declaration SHALL state, for the activity it describes: its stable code, its version,
the applicability rules that gate it, its hard constraints, and its features. Each feature
SHALL state the metric it reads, the unit it expects that metric in, how that metric is
aggregated over a day, how the aggregated value is normalised, how it enters the score,
and its behaviour when the value is missing.

#### Scenario: A feature carries its full recipe

- **WHEN** a declaration defines a feature
- **THEN** the feature names a metric, the unit it expects, an aggregation, a
  normalisation with its parameters, how it enters the score and a null policy
- **AND** a feature missing any of these is rejected

#### Scenario: A feature restates the unit it expects

- **WHEN** a feature names a unit that is not the canonical unit of the metric it reads
- **THEN** the service fails to start, naming the feature, the unit it declared and the
  unit the metric is carried in

#### Scenario: A constraint names the reason it produces

- **WHEN** a declaration defines a hard constraint
- **THEN** the constraint names the machine-readable reason code that the result will
  carry when it fires

#### Scenario: An activity may declare bounds

- **WHEN** a declaration states a lower and an upper bound for its score
- **THEN** results for that activity never fall below the lower bound or rise above the
  upper one

### Requirement: A feature declares whether it adds to the score or limits it

A declaration SHALL be able to state, per feature, whether the feature contributes a
weighted share of the score or limits the whole score. A limiting feature SHALL declare
how far it may pull the score down, and SHALL NOT be able to pull it to zero, because a
result of zero belongs to a constraint that can name its reason.

#### Scenario: A limiting feature caps an otherwise perfect day

- **WHEN** an activity declares a limiting feature and a day is ideal on every other
  feature while that feature is at its worst
- **THEN** the activity's score is reduced to the limit the feature declares
- **AND** the result is still a score rather than a refusal, and carries no reason code

#### Scenario: A limiting feature does not consume weight

- **WHEN** an activity declares a limiting feature alongside contributing features
- **THEN** the contributing features' weights are normalised among themselves
- **AND** adding or removing a limiting feature does not rescale them

#### Scenario: A missing value does not punish through a limiting feature

- **WHEN** the metric behind a limiting feature has no value for a day and its null policy
  is to degrade
- **THEN** the feature does not reduce the score at all

### Requirement: A declaration is validated when it is loaded

The service SHALL validate every declaration against the metric dictionary and the
normaliser, aggregation and applicability registries at load time, and SHALL refuse to
start when a declaration is invalid. An invalid declaration SHALL NEVER be silently
skipped.

#### Scenario: An unknown metric stops the start

- **WHEN** a declaration references a metric that is not in the metric dictionary
- **THEN** the service fails to start, naming the declaration and the unknown metric

#### Scenario: Normaliser parameters are checked against the normaliser

- **WHEN** a declaration uses a normaliser with parameters that do not satisfy that
  normaliser's parameter schema
- **THEN** the service fails to start, naming the feature and what is wrong
- **AND** it does not fall back to a default curve

#### Scenario: A threshold outside the metric's plausible range stops the start

- **WHEN** a declaration states a threshold or curve parameter that falls outside the
  physically plausible range of the metric it applies to
- **THEN** the service fails to start, naming the feature, the value and the range
- **AND** a value that is plausible only when read in a non-canonical unit is rejected by
  this check together with the declared unit

#### Scenario: A broken declaration is never partially applied

- **WHEN** one declaration out of four is invalid
- **THEN** the service does not start with the remaining three

### Requirement: Rules that apply to every activity are declared once

The service SHALL support constraints that are declared once and included by reference,
and SHALL apply an included rule to every activity that includes it, indoor activities
included.

#### Scenario: A cross-cutting constraint reaches every activity

- **WHEN** a shared severe-weather constraint is declared once and included by all
  activities
- **THEN** a severe-weather day zeroes every activity that includes it, indoor
  sightseeing among them
- **AND** the rule exists in exactly one place in the catalogue

#### Scenario: A rule an activity does not include does not reach it

- **WHEN** a shared rule is included by three activities and omitted by a fourth
- **THEN** conditions that fire the rule leave the fourth activity scored on its own merits
- **AND** omitting the rule required no exception in code

#### Scenario: An unknown include is an error

- **WHEN** a declaration includes a shared rule that does not exist
- **THEN** the service fails to start naming the missing rule

### Requirement: Weights are normalised on load

The service SHALL normalise the weights of an activity's contributing features so that
they sum to one before any score is computed. Editing one weight SHALL NOT change the scale of the result.

#### Scenario: Weights that do not sum to one are rescaled

- **WHEN** a declaration's feature weights sum to 2.0
- **THEN** they are rescaled to sum to 1.0, preserving their ratios
- **AND** the maximum achievable score is unchanged

#### Scenario: A zero-weight set is rejected

- **WHEN** a declaration's feature weights sum to zero
- **THEN** the service fails to start naming that declaration

### Requirement: A published declaration version is immutable

The service SHALL treat a published declaration version as immutable. A rule change SHALL
be published as a new version, and the version used SHALL be reported with any result
computed from it.

#### Scenario: Editing a published version is refused

- **WHEN** the catalogue is loaded with content for an already-published version that
  differs from what was published
- **THEN** loading fails, naming the activity and the version
- **AND** the stored version is not overwritten

#### Scenario: A new version does not invalidate old results

- **WHEN** version 2 of an activity is published
- **THEN** a result computed earlier still identifies version 1
- **AND** version 1 remains available for reproducing that computation

### Requirement: Applicability is declared, not coded

A declaration SHALL name the applicability rules that gate the activity, by reference to
the applicability registry, and an activity that names no rule SHALL be applicable
everywhere.

#### Scenario: An activity is gated by a named rule

- **WHEN** a declaration names an applicability rule with its parameters
- **THEN** the activity is offered only where that rule holds

#### Scenario: An activity without rules is universal

- **WHEN** a declaration names no applicability rule
- **THEN** the activity is applicable at every location
