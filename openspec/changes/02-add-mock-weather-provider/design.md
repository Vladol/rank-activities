## Context

Stage 3 (`docs/development-flow/stage-three.md`) recorded 36 live Open-Meteo responses
and established the two facts this design turns on: an archive response is
shape-identical to a forecast response, and a marine request over land returns HTTP 200
with an all-null series rather than an error. Everything below follows from wanting
those recordings — and only those recordings — to be what the service reads during
development.

The seam is created by `01-add-weather-source-contract` (capability ports, canonical units,
the series type and typed failures), which must land first. This change implements that
seam with recorded data; the live Open-Meteo client implements it with HTTP later.

## Goals

- `npm test` and `npm run start:dev` never touch the network.
- The same ranking input produces the same ranking output on any day, on any machine.
- Scenarios that cannot be observed in September (deep winter, polar night, holes in a
  series) are available today.
- A fixture is evidence of how the API behaves, not a document of how we imagine it
  behaves.

## Non-goals

The live HTTP client, retries, timeouts, the circuit breaker, caching, the scoring
engine, activity declarations, `WEATHER_PROVIDER=record`, the scenario generator and
the live contract test. Each is its own change.

## Decision 1: The mock replaces the transport, not the parsing

**Decision.** The mock provider reads a raw recorded body and passes it through the same
zod schema and the same raw→domain mapper the live adapter will use. This change
therefore also introduces `open-meteo.schema.ts` and `open-meteo.mapper.ts`, plus the
domain types they map onto (`WeatherSeries`, `MetricCode`, `WeatherError`, `Result`),
which come from `01-add-weather-source-contract`.

**Alternative rejected: a mock that returns domain objects directly.** It is smaller and
keeps this change to "just a mock". It is also worthless: a fixture that never goes
through `JSON.parse`, the zod schema and the unit conversions proves nothing about the
API. Every stage 3 finding worth encoding — `snowfall` in centimetres beside
`snow_depth` in metres, naive ISO timestamps, nulls inside series, a missing `results`
key — lives exactly in the parsing layer that this alternative skips. We would ship a
green suite over data no adapter had ever read.

**Alternative rejected: intercepting HTTP with `msw` or `nock`.** This is the most
faithful option and it is the right one *later*: it exercises the real client's timeouts,
retries and status handling. It cannot be done first, because there is no client to
intercept. It becomes its own change once the live adapter exists.

**Scope note.** This decision makes the change wider than the phrase "mock provider and
fixtures" suggests. The extra surface is one zod schema and one
mapper — the smallest set that makes a fixture mean something. If that
trade is unwanted, the fallback is Decision 1's first alternative, and the fixtures then
have to be re-validated when the adapter lands.

## Decision 2: The time axis is rebased onto the current date

**Decision.** On every read, the mock shifts a fixture's timestamps by a whole number of
days so the first day of the series lands on the current local date of the fixture's
location. Values, nulls, series length and local time-of-day are untouched;
`utc_offset_seconds`, `timezone` and the grid coordinates are untouched.

Rebasing is a pure function `(fixture, today) => response`, so it is testable on its own
and two reads on the same date are byte-identical.

**Alternative rejected: serve the fixture verbatim and freeze the clock.** A `ClockPort`
pinned to the capture date is the most honest option — the bytes that come out are the
bytes that were recorded. It was rejected for two reasons. First, it spreads: every
place that needs "now" has to take the port, and a single `new Date()` left behind
reintroduces the drift silently. Second, the dev server then permanently claims it is
7 September 2026, which makes a manual walk-through of the API confusing in a way that
has nothing to do with what is being tested.

**Alternative rejected: serve verbatim and forbid the domain from asking "what is
today".** Attractive while ТД-01 (partial current day, `stage-two.md` §10) is deferred,
because the domain then only reads local dates out of the response. It fails the moment
that debt is paid — and paying it is what makes the current day correct at all — so it
buys a short reprieve at the cost of a rewrite.

**Cost accepted.** The mock no longer returns exactly the recorded bytes. That is
covered by a test asserting the rebase is a pure day-shift: same length, same values,
same nulls, same time-of-day, dates shifted by a constant.

## Decision 3: Fixtures are resolved by coordinates rounded to two decimals

**Decision.** The lookup key is `lat.toFixed(2):lon.toFixed(2)` — the same rounding the
live adapter's cache key uses (stage-three.md §7.3). A coordinate no fixture covers is
an explicit error naming the missing fixture, never a nearest-neighbour match.

**Alternative rejected: a scenario name in the request or in an environment variable.**
Simpler to implement and to reason about, but it changes the shape of the request
depending on the source, so the mock path stops being the live path. Coordinate lookup
keeps `SeriesRequest` identical for both.

**Alternative rejected: nearest-neighbour fallback.** It would make the dev server always
answer. It would also mean a test for Prague silently scored against Lisbon's data. An
explicit miss is worth more than a convenient wrong answer — the same principle as
`NotApplicable` over `score: 0`.

## Decision 4: Two ski fixtures, from two different endpoints

**Decision.** Ship both `chamonix-winter-ski` (archive, January 2025, `snow_depth`
0.75–1.6 m) and `queenstown-nz-ski` (live forecast, `snow_depth` up to 0.05 m). The
archive fixture doubles as the null-policy fixture, because ERA5 returns `visibility` and
`freezing_level_height` null in all 168 slots.

**Alternative rejected: the archive fixture alone.** It carries ERA5 artefacts a forecast
never has. Testing the whole ski path against it would bake those artefacts into our
expectations of "a normal response".

**Alternative rejected: Queenstown alone.** The only ski fixture that is a genuine
forecast, but 5 cm of snow cannot express "excellent skiing", and the fixture stops
working when the southern season ends.

**Alternative rejected: synthesising a winter series.** Fastest, and it is what the
fixture set would have contained had stage 3 not checked. It would encode our idea of a
winter response — including, on the evidence of the null finding, an idea that is wrong.

## Decision 5: Source selection is not specified here

**Decision.** Which source is bound, how the choice is reported and what happens for a
declared-but-unimplemented value (`record`) are properties of the seam and are specified by
`weather-sources`. This change only requires that the recorded sources be the development
default and that they never reach the network.

**Alternative rejected: keeping the selection rule in this capability.** It is where the
rule was first written and it reads naturally beside the mock. It would also place a
general rule inside a capability about fixtures, so the live adapter's change would have to
modify a mock spec in order to state how the live source is selected.

## Decision 6: Fixtures live under `src/`, not under `docs/`

**Decision.** Fixtures live in `src/modules/weather/adapters/mock/fixtures/`, as copies
of the stage 3 captures. The manifest records where each came from.

**Reason, and a blocker to flag.** `/docs` is in `.gitignore`. The stage 3 captures under
`docs/investigation/open-meteo/samples/` are therefore not in version control — neither
are `flow.md`, `stage-one.md`, `stage-two.md` and `stage-three.md`. Fixtures are code
and must be committed, so they cannot live there under the current ignore rule.
This repeats the open question raised in `stage-one.md` §6.4: if the `/docs` entry is
not deliberate, it should be removed, and this decision can then be revisited.

**Alternative rejected: the mock reads directly from `docs/investigation/`.** No
duplication, and the evidence and the fixture can never drift apart. Rejected on the
ignore rule alone — the fixtures would not survive a clone — and on layering:
`docs/` holds evidence for humans, `src/` holds inputs for the program.

## Architecture

```
ForecastPort / MarinePort / ArchivePort   (from 01-add-weather-source-contract)
        ▲
        │ implements
Recorded sources
        │
        ├─ FixtureRegistry     coords → raw body   (manifest-driven, loaded once at startup)
        ├─ TimeAxisRebaser     (fixture, today) → raw body with shifted dates   [pure]
        ├─ openMeteoSchema     zod validation of the raw body                   [shared with the live adapter]
        └─ openMeteoMapper     raw → WeatherSeries, canonical units             [shared, pure]
```

Only the recorded sources and `FixtureRegistry` do I/O, and only at startup. The
rebaser and the mapper are pure functions, testable without Nest.

## Data flow

1. `RankActivities` asks the port for a series for coordinates and a horizon.
2. `FixtureRegistry` resolves the rounded coordinates to a raw body, or returns a miss.
3. `TimeAxisRebaser` shifts the axis onto today.
4. `openMeteoSchema` validates; a failure is a `WeatherError`, never a throw into the domain.
5. `openMeteoMapper` converts to `WeatherSeries` in canonical units (km/h → m/s,
   m → km for visibility; `snowfall` stays in centimetres and `snow_depth` in metres,
   as recorded).
6. The domain sees only `WeatherSeries`.

An error fixture short-circuits at step 2 and produces the recorded status, content type
and body, so steps 4 and 5 face the same bytes the live path would.

## Error handling

| Recorded case | Mock behaviour | Expected caller behaviour |
|---|---|---|
| 400 + `{"error":true,"reason":…}` | Replays status and body | Domain error; `reason` logged, not returned |
| 200 + empty body | Replays a zero-length body | Parse failure reported before `JSON.parse` |
| 403 + HTML | Replays status and `content-type` | Content type checked before parsing |
| Lookup with no `results` key | Replays the body verbatim | Empty result, not a failure (`weather-sources`) |
| Marine, all-null series | Replays 200 + nulls | Candidate `NO_COASTLINE_NEARBY`, per stage-three.md §5.1 |
| No fixture for the coordinates | `WeatherError` naming the miss | Test fails loudly |

## Testing

- **Rebaser** — pure unit tests: day shift is constant, length preserved, nulls
  preserved, time-of-day preserved, `daily`/`hourly` stay aligned, `sunrise`/`sunset`
  shift with the rest.
- **Mapper** — unit tests per conversion, with the three unit traps from stage-three.md
  §2.4 as named cases.
- **Schema** — every fixture parses; a fixture with a key removed fails.
- **Registry** — exact hit, rounded hit, explicit miss, manifest/file consistency.
- **Suite-wide** — an outbound-socket guard fails the run if anything reaches the
  network.
- **Provider selection** — `record` exits non-zero with the expected message.
