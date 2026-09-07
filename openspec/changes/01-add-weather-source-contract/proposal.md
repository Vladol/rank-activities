## Why

Three of the four axes of change this project is built around run through one seam:
swapping the weather provider, adding a metric, and adding an activity that needs a
metric nobody fetched before. Stage 3 (`docs/development-flow/stage-three.md`) measured
what that seam has to absorb, and the findings are not cosmetic:

- **Units disagree inside a single response.** `snowfall` arrives in centimetres beside
  `snow_depth` in metres; wind is km/h, visibility is metres, `sunshine_duration` is
  seconds. A 100× error in snow costs one oversight.
- **Units can change without the field names changing.** `temperature_unit=fahrenheit`
  returns `temperature_2m: 72.0` under the same key. Reading values without reading
  `*_units` is silent data corruption.
- **`null` inside a series is normal**, not an incident — ERA5 returns `visibility` null
  in all 168 slots because the model has no such variable.
- **Failures do not look like failures.** HTTP 200 with an empty body, HTTP 403 with an
  HTML body from nginx, HTTP 400 whose `reason` field is factually wrong, and a marine
  request over land that answers 200 with a full grid of nulls.

Stage 4 (`docs/development-flow/stage-four.md` §5) concluded that these cannot be
absorbed adapter by adapter. They need one contract that every source obeys and one
test suite that proves it. Without that contract, "swap the provider" means re-testing
the scoring engine, and "add a metric" means finding every place a unit is assumed.

## What Changes

- **Capability ports replace a single provider port.** `ForecastPort`, `MarinePort` and
  `ArchivePort` are separate seams, because their hosts, cache TTLs and failure
  semantics differ — for marine, an all-null series is an applicability signal, not an
  outage. **BREAKING** relative to `02-add-mock-weather-provider`, which introduced one
  `WeatherProviderPort`; that change is amended in place, since it has not been applied.
- **A canonical unit per metric**, declared in one metric dictionary together with the
  capability that serves it. Unit conversion happens in the vendor mapper and nowhere
  else.
- **Failures are values.** Every port returns a `Result`, never throws, and maps
  transport, status, content-type, parse and validation faults onto a fixed set of error
  codes. The source's own error text is logged, never returned.
- **Provenance travels with the data**: which source, which grid point, when fetched,
  whether stale. Moved here from the mock change, since it is a property of every source.
- **Provider selection is explicit and fails loudly.** Moved here from
  `02-add-mock-weather-provider`: choosing a source is not a mock concern.
- **A shared conformance suite** every adapter must pass before it can be bound, so
  "interchangeable" is a checked property rather than an intention.
- **Only planned metrics are fetched.** The request carries the union of the metrics that
  applicable activities actually declare, so an inland location makes no marine call.
- **A place-lookup port**, separate from the time-series ports but under the same failure
  rules, so that every outbound data source in the service is reached through one style of
  seam. What a lookup result *means* — which candidate to choose, what counts as not found
  — stays with `location-applicability`.

**Out of scope, deliberately** (each is its own change):

- The live Open-Meteo adapter itself. This change defines the contract and the domain
  types; the vendor package that implements it lands next, verified by the suite created
  here.
- Caching, stale-while-revalidate, single-flight, retries and the circuit breaker. They
  are decorators over these ports and get their own change, so the ports stay pure.
- What a place lookup *means*: candidate selection, stable identity and the not-found
  reason belong to `location-applicability`. This change defines only the seam it travels
  through, because a recorded source has to implement that seam before the meaning can be
  tested against fixtures.
- Which metrics each activity needs. That is the activity declaration
  (`03-add-activity-declaration-model`), and this contract only carries the union.

## Capabilities

### New Capabilities

- `weather-sources`: reaching every external data source through one contract — capability
  ports for weather, marine and archive series plus a place-lookup port, canonical units,
  missing-value semantics, provenance, typed failures, source selection, and the
  conformance suite that keeps sources interchangeable.

### Modified Capabilities

None. `weather-mock-data` is not yet in `openspec/specs/`; the pending
`02-add-mock-weather-provider` change is amended directly instead of carrying a delta.

## Impact

| Area | Effect |
|---|---|
| `src/domain/shared/` | `Result`, domain errors |
| `src/domain/weather/` | `MetricCode` + metric dictionary, canonical units, `WeatherSeries`, provenance, `mergeSeries` |
| `src/modules/weather/ports/` | Capability ports, the place-lookup port, DI tokens, `SeriesRequest`, `WeatherError` |
| `src/modules/weather/` | Source registry and metric planner |
| `src/modules/weather/contract/` | Shared conformance suite |
| `src/config/` | `WEATHER_PROVIDER` handling moves behind explicit source selection |
| `openspec/changes/02-add-mock-weather-provider/` | Amended: consumes this contract instead of defining its own port |
| Dependencies | None added |
