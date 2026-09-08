## Why

After `01`–`05` the service can rank activities, explain every number and run its entire
test suite — and it has never once contacted Open-Meteo. Every seam exists, and the only
implementation behind them is the recorded one. The assignment names Open-Meteo as the
data source; today nothing in `openspec/` requires that any code ever speak to it.

`01-add-weather-source-contract` deferred this deliberately: it defines the contract and
the conformance suite, and says "the vendor package that implements it lands next".
Four design documents refer to "the live adapter's change" as an existing plan. It was
never written, and it carries the facts stage 3 measured that no other change absorbs:

- **Unit parameters change values without changing field names.** `temperature_unit=fahrenheit`
  returns `temperature_2m: 72.0` under the same key with only `*_units` telling the truth
  (`forecast-units-imperial.json`). Reading values without asserting `*_units` is silent
  corruption of every threshold downstream.
- **Failures do not look like failures.** HTTP 200 with a zero-byte body, HTTP 403 with an
  nginx HTML page, HTTP 400 whose `reason` names an internal Swift type, and HTTP 400 whose
  `reason` is factually wrong (`Given 16` for a horizon of 30). Each was observed live and
  each defeats a naive `await res.json()`.
- **The response is bound to the model grid, not to the request.** The answered latitude,
  longitude and elevation differ from the requested ones and are the only honest provenance.
- **20 % of the 136 ms is TCP+TLS**, and a coastal location always makes two calls — so
  connection reuse is a property of the transport, not an optimisation to add later.
- **Three limits, the daily one twelve times stricter than the hourly**, no authentication,
  and a `429` whose body shape cannot be verified without violating the limits it protects.

Until this change exists, `weather-mock-data` is not a test double for anything: a fixture
proves something about the live adapter only once the live adapter travels the same path.

## What Changes

- **An Open-Meteo vendor package** implementing the forecast, marine and archive capability
  ports and the place-lookup port from `weather-sources`, admitted by the same conformance
  suite that admits the recorded sources.
- **The transport decides what it is holding before it parses it**: status, content type and
  emptiness are examined first, so an HTML error page and a zero-byte body become typed
  failures instead of a `SyntaxError` thrown past the schema.
- **Units are asserted, never requested.** The adapter sends no `*_unit` parameter and
  validates every `*_units` field against the unit the metric dictionary expects; a
  mismatch is a failure, not a conversion.
- **Vendor vocabulary is confined to the vendor package.** The source's variable names exist
  in exactly two files, and that is a grep-checkable claim rather than a convention.
- **Provenance comes from the response**: the answered grid point, its elevation, the
  source's own generation time and the moment we fetched it.
- **Status faults map onto the shared error codes**, with `429` decided by status and
  `Retry-After` alone, because the body shape at the limit is an unverified assumption.
- **A recording mode**: the live source with a writer attached, so a new fixture is a
  by-product of a real request rather than a hand-edited file. This is the
  `WEATHER_PROVIDER=record` value that `weather-sources` already requires the service to
  reject while it is unimplemented.
- **A scheduled contract test against the live API**, outside the default suite, validating
  a live response with the same schema the adapter uses — the only mechanism that can
  notice that the fixtures have gone stale.

**Out of scope, deliberately:**

- Caching, stale-while-revalidate, single-flight, retries, the circuit breaker and the
  outbound budget. They are decorators over this adapter and belong to
  `07-add-source-caching-and-resilience`; the adapter stays a plain implementation of the
  ports, and the wrapping order is stated there.
- The commercial endpoint (`customer-api.open-meteo.com` with `apikey`). The syntax is
  identical, so it is a host and a query parameter, added when a key exists. The free tier
  forbids commercial use, and the README says so.
- Air Quality and Flood. Ruled out in stage 3 §1 and unchanged here.
- Persisting anything the adapter fetches. Storage is `08-add-data-persistence`.

## Capabilities

### New Capabilities

- `open-meteo-source`: the live Open-Meteo implementation of the source seams — the vendor
  package layout, transport safety, unit assertion, vendor-vocabulary containment,
  provenance from the response, status-fault mapping, the recording mode and the live
  contract test.

### Modified Capabilities

None. `weather-sources` already specifies what any source must do; this change adds what
*this* source does. `weather-mock-data` is unaffected: both implementations pass the same
suite, which is the point of having one.

## Impact

| Area | Effect |
|---|---|
| `src/modules/weather/adapters/open-meteo/` | New: capabilities, http, and per-capability `variables` / `schema` / `mapper` |
| `src/modules/weather/adapters/open-meteo/geocoding/` | New: the place-lookup implementation |
| `src/modules/weather/adapters/record/` | New: the live source plus a fixture writer |
| `src/modules/weather/weather.module.ts` | Binds `open-meteo` and `record` as selectable sources |
| `src/domain/weather/metric.ts` | `MAPPER_VERSION` declared here, resolving the open question in `01/design.md` |
| `test/contract/open-meteo.live.spec.ts` | New: scheduled, excluded from the default run |
| `docs/requirements/mocking.md` | The recording procedure gains its live path |
| `openspec/changes/01-add-weather-source-contract` | Prerequisite: ports, units, error codes, conformance suite |
| `openspec/changes/02-add-mock-weather-provider` | Prerequisite: the fixtures this adapter is checked against |
| Dependencies | `undici` — the first consumer arrives with this change |
