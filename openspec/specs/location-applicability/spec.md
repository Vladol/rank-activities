## Purpose

Turning a user's location input into a resolved, stably identified place and deciding
which activities are possible there at all — so that an activity impossible for
geographical reasons is never reported as an activity with poor conditions, and so that
impossible activities cost nothing to evaluate.

## Requirements

### Requirement: A location is accepted as a city name or as coordinates

The service SHALL accept either a place name or geographic coordinates, and SHALL resolve
either into a location carrying coordinates, a time zone, an elevation and its
administrative context.

#### Scenario: A city name is resolved

- **WHEN** a ranking is requested for a city name
- **THEN** the resolved location carries coordinates, a time zone, an elevation and the
  country

#### Scenario: Coordinates skip the lookup

- **WHEN** a ranking is requested for coordinates
- **THEN** the same path is followed without a name lookup

#### Scenario: Different spellings of one city resolve to one place

- **WHEN** the same city is requested under different spellings or in different languages
- **THEN** all of them resolve to the same coordinates and the same location identity

#### Scenario: Invalid coordinates are rejected

- **WHEN** coordinates outside the valid range are supplied
- **THEN** the request fails with the invalid-coordinates reason
- **AND** no outbound lookup is attempted

### Requirement: An ambiguous name is resolved and the choice is disclosed

When a name matches several places, the service SHALL choose the most populous candidate
and SHALL report which place it chose, including the country and the administrative
region.

#### Scenario: A name shared by several countries

- **WHEN** a name matching places in different countries is requested
- **THEN** the most populous candidate is used
- **AND** the answer states the chosen place's name, country and region

#### Scenario: An unknown name is an error, not a guess

- **WHEN** a name matches no place
- **THEN** the request fails with the location-not-found reason
- **AND** no spelling correction or nearest-match substitution is performed

### Requirement: A location has a stable identity

The service SHALL derive a location's identity from its coordinates rounded to the
precision the data source's grid justifies, so that the same place yields the same
identity across requests and processes.

#### Scenario: Repeated requests share an identity

- **WHEN** the same city is requested on two separate occasions
- **THEN** both answers carry the same location identity

#### Scenario: Nearby points within the grid share an identity

- **WHEN** two coordinate pairs a few hundred metres apart round to the same grid key
- **THEN** they resolve to the same location identity

### Requirement: A location profile is computed once, reused and versioned

The service SHALL compute a location's applicability profile on first use, reuse it for
later requests, and record the version of the rules that produced it, so that a rules
change can invalidate profiles deliberately rather than silently.

#### Scenario: The profile is not recomputed per request

- **WHEN** a second ranking is requested for a location already profiled
- **THEN** the stored profile is reused
- **AND** no evidence-gathering calls are repeated

#### Scenario: The profile records its evidence and its rules version

- **WHEN** a profile is created
- **THEN** it records, per activity, whether it is applicable, on what evidence, and under
  which rules version

#### Scenario: A rules version change makes profiles recomputable

- **WHEN** the applicability rules version changes
- **THEN** profiles produced under the previous version are recognised as outdated

### Requirement: Applicability is decided before weather data is requested

The service SHALL determine which activities are applicable before requesting weather
data, and SHALL restrict the requested metrics to those the applicable activities need.

#### Scenario: An inapplicable activity removes its data need

- **WHEN** an activity is not applicable at a location
- **THEN** the metrics only that activity needs are not requested
- **AND** a capability needed by no applicable activity is not called at all

#### Scenario: An inapplicable activity is reported, not scored

- **WHEN** an activity is not applicable at a location
- **THEN** it is reported as inapplicable with a machine-readable reason
- **AND** it is not given a score of any value

### Requirement: Coastal applicability is confirmed by two probes on different days

The service SHALL determine whether wave-based activities are possible by probing the
marine source, and SHALL treat a single all-null response as a candidate rather than as
proof. Confirmation SHALL require a second all-null response obtained on a different day.
Until confirmed, the activity SHALL be reported as missing data, never as inapplicable.

#### Scenario: An inland location is a candidate after one probe

- **WHEN** a marine probe for a location returns a complete grid with no values
- **THEN** the location is recorded as a candidate for having no coastline
- **AND** the wave-based activity is reported as missing data, marked retryable

#### Scenario: A second probe on another day confirms geography

- **WHEN** a second marine probe on a later day again returns no values
- **THEN** the wave-based activity is recorded as inapplicable with the no-coastline reason

#### Scenario: Data on a later probe clears the candidacy

- **WHEN** a later probe returns wave values for a candidate location
- **THEN** the candidacy is cleared and the activity is scored normally

#### Scenario: A lake is not a sea

- **WHEN** the probed location is on inland water that the wave model does not cover
- **THEN** it follows the same path as any other uncovered location and ends as
  inapplicable once confirmed

#### Scenario: A probe is cheap and is not repeated per request

- **WHEN** a location has an unexpired probe record
- **THEN** no new probe is issued for that location within the same day

### Requirement: Snow-season applicability is decided by climate evidence

The service SHALL decide whether snow-based activities are possible from historical
snowfall for the location, evaluated for the cold season of the location's own hemisphere,
and SHALL NOT decide it from the calendar month, the latitude or the elevation alone.

#### Scenario: A high equatorial city has no snow season

- **WHEN** a location at high elevation near the equator is profiled
- **THEN** the archive shows no cold-season snowfall
- **AND** snow-based activities are inapplicable there despite the elevation

#### Scenario: A low-lying arctic city has a snow season

- **WHEN** a location near sea level at a high latitude is profiled
- **THEN** the archive shows cold-season snowfall
- **AND** snow-based activities are applicable there despite the low elevation

#### Scenario: The southern hemisphere is not inverted by rule

- **WHEN** a southern-hemisphere location is profiled
- **THEN** the cold season examined is that location's own
- **AND** the outcome is derived from snowfall data, not from the month number

#### Scenario: Out of season is not inapplicable

- **WHEN** a location with a confirmed snow season is ranked in its warm months
- **THEN** snow-based activities remain applicable
- **AND** the absence of snow today is expressed by the scoring, not by inapplicability

### Requirement: Missing evidence degrades explicitly, never silently

When the evidence for an applicability decision is unavailable, the service SHALL either
fall back to a heuristic and mark the profile as heuristic, or report missing data — and
SHALL NEVER present an unverified decision as verified.

#### Scenario: An unavailable archive yields a marked heuristic profile

- **WHEN** the climate archive cannot be reached while profiling a location
- **THEN** the snow-season decision falls back to the declared heuristic
- **AND** the profile records that the decision is heuristic and can be recomputed later

#### Scenario: An unavailable geocoder fails the request

- **WHEN** a place name cannot be resolved because the lookup is unavailable
- **THEN** the request fails as unavailable and retryable
- **AND** no coordinates are guessed

#### Scenario: An unavailable marine source does not create geography

- **WHEN** the marine source fails while probing
- **THEN** the location does not become a no-coastline candidate
- **AND** the wave-based activity is reported as missing data

### Requirement: Activities without applicability rules are available everywhere

The service SHALL treat an activity that declares no applicability rule as possible at
every location, and SHALL perform no evidence gathering for it.

#### Scenario: Sightseeing needs no evidence

- **WHEN** a location is profiled
- **THEN** activities declaring no applicability rule are applicable
- **AND** no extra outbound call was made on their behalf
