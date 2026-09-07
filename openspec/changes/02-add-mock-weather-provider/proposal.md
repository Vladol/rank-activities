## Why

The ranking engine has to be built, tested and demonstrated without depending on the
network or on the weather outside the window. Two independent forces make this urgent
now, and stage 3 turned both from assumptions into measured facts
(`docs/development-flow/stage-three.md`):

1. **Determinism.** A ranking is a scoring function over a weather series. If the series
   changes between two runs, no test of that function means anything. Open-Meteo refreshes
   roughly hourly, so the same request returns different numbers within the same working
   day.

2. **Reachability.** Four of the scenarios the service must handle cannot be observed
   live at all in September:
   - deep-winter ski conditions — Chamonix currently returns `snow_depth = 0.0` for all
     168 forecast hours;
   - polar night — Tromsø currently has 13.7 hours of daylight;
   - holes in an hourly series — the live forecast returned 0 nulls across 21 variables
     and 7 locations;
   - a rejected marine location — this one *is* observable, and its shape was the
     stage 3 surprise (see below).

Waiting for winter is not a plan. The data has to be recorded once and replayed.

Stage 3 also found the two facts that shape the design:

- **Recorded archive responses are byte-shape-identical to forecast responses.** The
  same envelope, the same `hourly`/`daily`/`*_units` keys. A January archive response
  is a valid winter forecast fixture, and it arrives with real ERA5 nulls
  (`visibility` and `freezing_level_height` are null in all 168 slots) — so the
  "holes in the series" fixture is recorded, not invented.
- **A marine request for an inland point returns HTTP 200 with a full time grid and
  every value null**, not an error. Prague and Lake Geneva are indistinguishable from
  each other and from a wave-model outage. Any fixture set that omits this case would
  let a wrong `NotApplicable` ship unnoticed.

## What Changes

- Recorded sources behind every seam defined by `01-add-weather-source-contract` — the
  `ForecastPort`, `MarinePort` and `ArchivePort` capability ports and the place-lookup
  port — bound as the development default, resolving a request to a fixture by coordinates
  and serving the recorded response.
- A fixture set of recorded raw Open-Meteo responses covering the acceptance scenarios
  of `docs/development-flow/stage-two.md` §12, sourced from the stage 3 captures in
  `docs/investigation/open-meteo/samples/`.
- **Time-axis rebasing**: the mock shifts a fixture's first day onto the current local
  date, preserving values, nulls and series length. A fixture recorded in September
  still describes "the next seven days" in December.
- A documented, repeatable recording procedure (a script plus a fixture manifest), so
  a new fixture is a recorded response rather than a hand-edited one.
- Explicit failure fixtures: HTTP 400 with a JSON body, HTTP 200 with an empty body,
  HTTP 403 with an HTML body, and a geocoding miss with no `results` key — all four
  observed live in stage 3.

**Out of scope, deliberately** (each becomes its own change):

- `WEATHER_PROVIDER=record` — a live source that writes fixtures as a side effect. Until
  it exists, fixtures are recorded by the script. Rejecting an unimplemented source at
  startup is specified by `weather-sources`, not here.
- The scenario generator (synthetic series for normalizer unit tests). Needed only once
  normalizers exist, which is stage 5.
- The contract test against the live API. It validates responses with the adapter's zod
  schema, and that schema is written in the change that adds the Open-Meteo adapter.
- HTTP-level interception (`msw`/`nock`). It tests the real client's parsing, retries
  and timeouts — which belong to the adapter change, not to this one.

## Capabilities

### New Capabilities

- `weather-mock-data`: serving weather and geocoding responses from recorded fixtures
  instead of the live Open-Meteo API — fixture resolution, time-axis rebasing, failure
  replay, and the rules that keep a fixture an honest recording.

### Modified Capabilities

None. The seam itself — capability ports, canonical units, typed failures and source
selection — is owned by `weather-sources` (`01-add-weather-source-contract`), which must land
first. This change implements that seam with recorded data; the live adapter implements it
with HTTP.

## Impact

| Area | Effect |
|---|---|
| `src/modules/weather/ports/` | Consumed, not created: the ports come from `01-add-weather-source-contract` |
| `src/modules/weather/adapters/mock/` | New: provider, fixture loader, rebaser, manifest |
| `src/modules/weather/adapters/mock/fixtures/` | New: recorded raw responses |
| `src/config/env.schema.ts` | Unchanged here; unimplemented-source rejection is specified by `weather-sources` |
| `scripts/record-fixture.ts` | New: the recording procedure |
| `docs/requirements/mocking.md` | New: strategy and fixture table (flow.md §2.4 places process docs outside OpenSpec) |
| Network | None. `npm test` and `npm run start:dev` stop touching the network entirely |
| Dependencies | None added |
