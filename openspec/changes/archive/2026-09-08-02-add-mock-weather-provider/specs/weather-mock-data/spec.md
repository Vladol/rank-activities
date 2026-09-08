## Purpose

Serving weather, marine and geocoding responses from recorded Open-Meteo fixtures so
that ranking can be developed, tested and demonstrated without network access and
without waiting for the seasons — while keeping every fixture an honest recording of
what the live API actually returned.

## ADDED Requirements

### Requirement: The mock serves every source seam without touching the network

The recorded sources SHALL implement the same ports as the live sources — the forecast,
marine and archive capability ports and the place-lookup port — so that mock and live
requests travel the identical path, and SHALL make no outbound connection of any kind.

#### Scenario: Mock sources are the development default

- **WHEN** the service starts with no source configured
- **THEN** the recorded sources are bound for every capability and for place lookup
- **AND** the startup log states how many fixtures were loaded

#### Scenario: The mock never reaches the network

- **WHEN** any request is served with the recorded sources active
- **THEN** no outbound connection is made
- **AND** a test that forbids outbound sockets passes for the whole suite

#### Scenario: The mock obeys the same contract as any other source

- **WHEN** the recorded forecast source is exercised by the shared source conformance
  suite
- **THEN** it passes it unchanged, including canonical units, preserved gaps and typed
  failures

#### Scenario: Place lookup is served from fixtures too

- **WHEN** a place name is looked up while the recorded sources are active
- **THEN** the recorded lookup response is served through the place-lookup port
- **AND** no outbound connection is made

### Requirement: A fixture is resolved by rounded coordinates and the requested horizon

The mock SHALL resolve a request to a fixture by the requested coordinates rounded to two
decimal places — the same rounding the service uses to identify a location — so that mock
and live paths agree on what counts as "the same location". Where more than one recording
of the same location exists, the mock SHALL select among them by the window the request
asked for, and SHALL refuse rather than choose when the request names no window.

#### Scenario: A known location resolves to its fixture

- **WHEN** a forecast is requested for `38.7167, -9.1333` (Lisbon)
- **THEN** the mock serves the Lisbon fixture
- **AND** the response carries the recorded grid coordinates `38.75, -9.125`, not the
  requested ones

#### Scenario: A nearby coordinate resolves to the same fixture

- **WHEN** a forecast is requested for `38.7201, -9.1288`, which rounds to the same two
  decimals as the Lisbon fixture
- **THEN** the same fixture is served

#### Scenario: An unknown location is an explicit miss

- **WHEN** a forecast is requested for coordinates no fixture covers
- **THEN** the mock returns a `WeatherError` naming the missing fixture and the
  coordinates that would identify it
- **AND** it does NOT invent a series, return an empty series, or fall back to the
  nearest fixture

#### Scenario: The requested window chooses between two recordings of one place

- **WHEN** an archive series is requested for Chamonix, where a January and a July
  recording share the same rounded coordinates
- **THEN** the recording whose window covers the requested dates is served
- **AND** a request whose dates no recording covers is a miss naming the windows that
  were recorded

#### Scenario: An ambiguous location without a window is refused, not guessed

- **WHEN** a rolling forecast horizon is requested for a location whose only recordings
  are two archive windows
- **THEN** the mock returns a `WeatherError` naming both recordings and asking for a
  window
- **AND** it does NOT answer a January question with July data by serving whichever
  recording came first

### Requirement: The mock rebases a rolling forecast onto the current date

A fixture is recorded on one date and replayed on another. For a rolling forecast
horizon, the mock SHALL shift every timestamp so that the first day of the series falls
on the current local date of the fixture's location, preserving values, nulls, series
length and the local time-of-day of each slot. A request naming an explicit date window
SHALL be served on the dates that were recorded.

#### Scenario: A September fixture replayed in December

- **WHEN** a fixture whose series runs `2026-09-07` … `2026-09-13` is served on
  `2026-12-01` for a rolling seven-day horizon
- **THEN** the returned series runs `2026-12-01` … `2026-12-07`
- **AND** the hourly array still holds 168 entries
- **AND** the value at every index is byte-identical to the recorded value, nulls
  included

#### Scenario: Time of day survives the shift

- **WHEN** a fixture slot recorded at `2026-09-07T14:00` is rebased
- **THEN** the served slot reads `<new date>T14:00`
- **AND** `utc_offset_seconds`, `timezone` and `timezone_abbreviation` are unchanged

#### Scenario: Daily and hourly axes stay aligned

- **WHEN** a fixture carrying both `hourly` and `daily` blocks is rebased
- **THEN** the *n*-th `daily.time` entry still matches the local date of hours
  24*n* … 24*n*+23 of `hourly.time`
- **AND** `sunrise` and `sunset` are shifted by the same number of days as the rest

#### Scenario: Rebasing is a pure function of the fixture and the date

- **WHEN** the same fixture is served twice for the same current date
- **THEN** the two responses are byte-identical

#### Scenario: A request for explicit dates keeps them

- **WHEN** a marine series is requested for the window `2025-07-09` … `2025-07-12`
- **THEN** the served axis starts on the recorded date, not on today
- **AND** the values, the nulls and the series length are those of the recording

### Requirement: Fixtures are verbatim recordings

A fixture SHALL be the raw response body of a real Open-Meteo request, stored
unmodified. Fixtures SHALL NOT be hand-edited to produce a desired scenario: an edited
fixture proves the shape we imagined, not the shape the API returns.

#### Scenario: Every fixture is traceable to a request

- **WHEN** the fixture manifest is validated
- **THEN** every fixture file has a manifest entry carrying the exact request URL, the
  capture date and the observed HTTP status
- **AND** a fixture file with no manifest entry fails the check

#### Scenario: A fixture matches what the endpoint still returns in shape

- **WHEN** the recording script re-records an existing fixture
- **THEN** only values and timestamps differ from the stored file
- **AND** a difference in the set of keys fails the recording and reports which keys
  appeared or vanished

#### Scenario: A scenario that cannot be recorded is not faked

- **WHEN** a required scenario cannot be obtained from any Open-Meteo endpoint
- **THEN** it is recorded as an open gap in the manifest
- **AND** no synthesised fixture is added in its place

### Requirement: The fixture set covers the acceptance scenarios

The fixture set SHALL cover every scenario of `docs/development-flow/stage-two.md` §12
that does not carry the deferred-work marker, using the source that can actually
produce it.

#### Scenario: Winter ski conditions come from the archive

- **WHEN** the ski scenario "deep snow, hard frost, light wind" is needed
- **THEN** it is served from a recorded `archive-api` response for Chamonix in January
  (`snow_depth` 0.75–1.6 m, `temperature_2m_min` down to −13.5 °C)
- **AND** the fixture is accepted as a forecast response because the archive envelope
  carries the same keys as the forecast envelope

#### Scenario: A live southern-hemisphere ski case is kept alongside it

- **WHEN** the ski scenario needs a response that a forecast endpoint really produced
- **THEN** the recorded Queenstown forecast is served (`snow_depth` up to 0.05 m,
  `snowfall_sum` 3.5 cm)
- **AND** the two ski fixtures are distinct entries, because the archive one carries
  ERA5 artefacts a forecast never has

#### Scenario: Conditions that are not happening now come from the archive

- **WHEN** a scenario needs weather that no current forecast contains — extreme heat, a
  storm, a flat sea, polar night, a summer without snow
- **THEN** it is served from a recorded archive response for a date on which it did happen
- **AND** no fixture is hand-edited to manufacture the conditions

#### Scenario: Holes in a series are recorded, not invented

- **WHEN** the null-policy scenario is needed
- **THEN** the archive fixture is used, in which `visibility` and
  `freezing_level_height` are null in all 168 slots
- **AND** the fixture is not modified to introduce nulls anywhere else

#### Scenario: The inland marine case is covered

- **WHEN** a marine request is served for Prague or for Lake Geneva
- **THEN** the mock replays HTTP 200 with a complete time grid and `null` in every slot
- **AND** it does NOT replay an error, an empty series or a missing key

### Requirement: The mock replays failures, not only successes

The mock SHALL be able to serve the failure modes observed on the live API, replaying the
recorded status, content type and body unchanged, so that the error handling specified by
`weather-sources` is exercised without waiting for the live API to misbehave. How a caller
reacts to these bytes is specified there, not here.

#### Scenario: A structured API error

- **WHEN** a fixture is marked as an error fixture with status 400
- **THEN** the mock returns HTTP 400 with the recorded
  `{"error": true, "reason": "..."}` body, byte for byte
- **AND** the status and the body reach the adapter exactly as the live source would have
  delivered them

#### Scenario: A 200 with an empty body

- **WHEN** the empty-body fixture is served
- **THEN** the mock returns HTTP 200 with a zero-length body
- **AND** the body is delivered unparsed, so the adapter faces the same bytes the live
  source produced

#### Scenario: A 403 with an HTML body

- **WHEN** the HTML-error fixture is served
- **THEN** the mock returns HTTP 403 with `content-type: text/html` and the recorded
  nginx page
- **AND** the recorded content type is preserved, not replaced with a JSON one

#### Scenario: A geocoding miss has no results key

- **WHEN** the geocoding fixture for an unmatched name is served
- **THEN** the body is `{"generationtime_ms": <number>}` with no `results` key at all
- **AND** the missing key is preserved rather than normalised into an empty list

### Requirement: Adding a fixture is a recorded, repeatable procedure

Adding a fixture SHALL be a single documented command that performs the request, stores
the raw body and writes the manifest entry. Copying a response by hand SHALL NOT be a
supported path.

#### Scenario: Recording a new fixture

- **WHEN** an operator runs the recording script with a fixture name and a request URL
- **THEN** the raw body is written to the fixture directory unmodified
- **AND** a manifest entry is added with the URL, the capture date and the HTTP status
- **AND** the fixture is immediately resolvable by the mock with no further edits

#### Scenario: Recording refuses to overwrite silently

- **WHEN** the script is run for a fixture name that already exists
- **THEN** it reports the key-level difference and requires an explicit overwrite flag
- **AND** without that flag the existing fixture is left untouched
