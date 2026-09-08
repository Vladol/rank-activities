# scoring-engine Specification

## Purpose
Turning one activity declaration and one weather series into that activity's outcome for
one day — a score with a per-feature explanation, a refusal with a reason, or an honest
"not enough data" — deterministically and without any activity-specific code.

## Requirements

### Requirement: A score is computed only from what the declaration states

The engine SHALL compute a score from the features the declaration lists, the weights it
gives them and the profile in force, and SHALL NOT apply any activity-specific behaviour
of its own.

#### Scenario: The engine has no per-activity branches

- **WHEN** two declarations differ only in their feature parameters
- **THEN** both are evaluated by the same code path
- **AND** no behaviour depends on the activity's code or name

#### Scenario: The same inputs always produce the same score

- **WHEN** the same declaration, series, day and profile are evaluated twice
- **THEN** the score, the reason codes and the ordering of the explanation are identical

### Requirement: Hard constraints decide before weighting

The engine SHALL evaluate hard constraints before combining features and before applying
any feature's null policy. When a constraint fires, the activity's score for that day
SHALL be zero and SHALL carry the constraint's reason code. A zeroed score SHALL remain a
scored result, distinct from an inapplicable activity and from missing data.

#### Scenario: A violated constraint zeroes the day

- **WHEN** an activity's snow-cover constraint is violated on a day
- **THEN** the activity scores zero for that day and carries that constraint's reason code
- **AND** the result is a score, not a statement that the activity is unavailable here

#### Scenario: The first firing constraint is reported

- **WHEN** two constraints of an activity fire on the same day
- **THEN** the result carries the reason of the constraint declared first
- **AND** the choice is stable across runs

#### Scenario: A fired constraint outranks a missing required feature

- **WHEN** a constraint fires on a day on which a feature whose policy is "fail" has no
  value
- **THEN** the day is a ranked zero carrying the constraint's reason
- **AND** it is not reported as missing data, because what is known decides before what is
  absent

#### Scenario: A constraint that cannot be evaluated does not fire silently

- **WHEN** the metric a constraint reads is missing for that day
- **THEN** the constraint does not fire on absent data
- **AND** the feature-level null policy decides the outcome instead

### Requirement: Aggregation collapses a series into a day using the declared strategy

The engine SHALL aggregate an hourly series into a per-day value using the strategy the
feature declares, and SHALL use the day's own hour count rather than an assumed 24.

#### Scenario: A daylight-window aggregation ignores dark hours

- **WHEN** a feature declares aggregation over the daylight window
- **THEN** only the day's daylight hours contribute to the aggregated value

#### Scenario: A day with no daylight is a valid state

- **WHEN** a day has no daylight hours at all
- **THEN** a daylight-window aggregation yields no value rather than an arithmetic error
- **AND** the outcome is decided by the declared constraint or null policy, never by a
  non-numeric score

#### Scenario: The denominator is the day's actual hours

- **WHEN** a feature declares a share-of-hours aggregation
- **THEN** the share is computed over the hours the series actually holds for that day

### Requirement: Missing values follow the declared null policy

The engine SHALL apply the feature's null policy when its aggregated value is absent:
treat the feature as neutral, exclude it and redistribute its weight across the remaining
features, or fail the activity for that day.

#### Scenario: An excluded feature redistributes its weight

- **WHEN** a feature whose policy is "exclude" has no value for a day
- **THEN** the remaining features are reweighted to sum to one
- **AND** the score stays on the same scale as a fully-supplied day

#### Scenario: A required feature that is missing yields no data

- **WHEN** a feature whose policy is "fail" has no value for a day
- **THEN** the activity reports missing data for that day, naming the metric
- **AND** it does not report a score of zero

#### Scenario: A metric absent for the whole series is handled, not fatal

- **WHEN** a source returns a metric as null in every slot of the series
- **THEN** features reading it follow their null policy
- **AND** activities whose other features are satisfied are still scored

### Requirement: A day with too many gaps is reported as missing data

The engine SHALL treat a day as missing data when a metric the activity cannot do without
is present but incomplete beyond a configured share, and SHALL make that decision per day
rather than for the series as a whole. A metric that is absent for the whole day SHALL NOT
be judged by this rule, and SHALL be decided by the feature's null policy instead.

#### Scenario: A day above the gap threshold is not scored

- **WHEN** a metric behind a feature the activity cannot do without holds values for part
  of a day and exceeds the allowed share of gaps
- **THEN** that day reports missing data with the corresponding reason
- **AND** no score is produced for it from the remaining values

#### Scenario: A wholly absent metric is left to the null policy

- **WHEN** a metric a feature may do without holds no value at all for a day
- **THEN** the day is not rejected for incompleteness
- **AND** the feature's null policy decides, so an activity whose remaining features are
  satisfied is still scored

#### Scenario: The decision is per day

- **WHEN** one day of a series exceeds the threshold and another does not
- **THEN** each day is decided on its own completeness

### Requirement: Every score carries its explanation

The engine SHALL produce the per-feature explanation that a scored result carries as part
of the same evaluation that produced the score, never as a second pass over the same
inputs. What that explanation must contain for a client is specified by
`activity-ranking`.

#### Scenario: The explanation accounts for the score

- **WHEN** an activity is scored for a day
- **THEN** the weighted contributions of the contributing features, reduced by the factors
  of the limiting features, reproduce the score before bounds are applied
- **AND** each limiting feature's factor is visible in the explanation next to the value it
  was derived from

#### Scenario: Excluded features are visible as excluded

- **WHEN** a feature was excluded by its null policy
- **THEN** the explanation shows it as excluded rather than omitting it silently

### Requirement: Combination is weighted, and limiting features apply on top of it

The engine SHALL combine contributing features as a weighted sum of their normalised
values, then apply each limiting feature as a factor on that sum, bounded below by the
limit the feature declares. The engine SHALL NOT let a limiting feature reduce a score to
zero.

#### Scenario: One ruinous dimension is not compensated by the others

- **WHEN** a day is ideal on every contributing feature and worst on a limiting one
- **THEN** the score is far below a day that is merely average everywhere
- **AND** no assignment of weights alone could have produced that result

#### Scenario: A limiting feature at its best changes nothing

- **WHEN** a limiting feature's normalised value is at its maximum
- **THEN** the score equals the weighted sum of the contributing features

### Requirement: Declared bounds are applied after combination

The engine SHALL apply an activity's declared lower and upper bounds after weighting, and
SHALL NOT let bounds override a constraint-driven zero.

#### Scenario: A bounded activity stays inside its band

- **WHEN** an activity declaring a floor and a ceiling is scored on a day with poor
  conditions
- **THEN** its score is not below the floor
- **AND** on ideal conditions its score is not above the ceiling

#### Scenario: A constraint beats the floor

- **WHEN** a constraint fires for an activity that declares a floor
- **THEN** the score is zero, not the floor value

### Requirement: The profile in force is identified with the result

The engine SHALL evaluate against an identified, versioned scoring profile and SHALL
report that identity with the result, so a computation can be reproduced later.

#### Scenario: The result names the profile it used

- **WHEN** an activity is scored
- **THEN** the result carries the profile identifier and version applied

#### Scenario: Two profiles over one declaration give two results

- **WHEN** the same declaration and series are evaluated under two profiles
- **THEN** each result carries its own profile version
- **AND** the declaration was not modified to support the second profile

### Requirement: Curves, aggregations and derived metrics extend by registration

The service SHALL make normalisation curves, aggregation strategies and derived metrics
available by registration, so a new one becomes usable by every declaration without
modifying the engine.

#### Scenario: A new curve is usable without engine changes

- **WHEN** a new normalisation curve with its parameter schema is registered
- **THEN** any declaration may reference it by name
- **AND** the engine was not modified

#### Scenario: A derived metric is computed from base metrics

- **WHEN** a feature reads a metric no source provides directly
- **THEN** the value is computed from the base metrics the derived metric declares
- **AND** the derivation is available to every activity, not to one
