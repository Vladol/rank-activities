## Context

`src/domain/` is empty and no weather module exists. `02-add-mock-weather-provider` is
proposed but not applied; it introduced a single `WeatherProviderPort` as the seam and
also created the minimum domain types the fixtures map onto. Stage 4
(`docs/development-flow/stage-four.md` §5) revisited that seam with the stage 3
measurements in hand and split it. This change therefore owns the contract and the
domain types, and the mock change is amended to consume them.

Implementation order: this one first, then `02-add-mock-weather-provider` (recorded sources
behind these seams), then `03-add-activity-declaration-model`, then
`04-add-location-applicability`, then `05-add-activity-ranking`. Each later change depends on the
types created here, and the three after the mock depend on its fixtures for their tests.

## Goals / Non-Goals

**Goals:**

- One seam, verified by one suite, such that adding or replacing a source touches no
  domain, scoring, API or storage code.
- Every stage 3 surprise absorbed at the boundary rather than defended against
  repeatedly further in.
- The mock and the live source travel the identical path, so a fixture proves something
  about the live adapter.

**Non-Goals:**

- Caching, retries, the circuit breaker and stale-while-revalidate. They wrap these
  ports and arrive with their own change; the ports stay free of cross-cutting concerns.
- The Open-Meteo adapter. This change ends at the contract plus the conformance suite.
- What a place lookup means — candidate selection, identity, the not-found reason. Only
  the seam is here; see Decision 8.
- Choosing a source per metric at runtime. The router exists conceptually, but the first
  implementation is a static capability-to-source table.

## Decisions

### Decision 1: A port per capability, not one provider port

Forecast, marine and archive differ in host, refresh cadence, cache TTL (1 h against
3 h) and failure semantics: for marine, an all-null series is evidence about the
location, while for forecast the same shape is a defect. A source declares the
capabilities it serves; a vendor package may serve one or several.

**Alternative rejected: one `WeatherProviderPort` with `supports(metric)`** — the shape
in flow.md §4.4 and in the mock change. It is smaller, and it forces every adapter to
implement methods it cannot serve and to return "unsupported" for most of the surface. It
also hides the TTL and failure differences behind a uniform method, so the caching change
would have to reintroduce the distinction anyway.

**Alternative rejected: one port per vendor.** Interchangeability then means implementing
a competitor's shape, which is exactly the coupling the port exists to remove.

### Decision 2: The metric dictionary carries the serving capability

Each metric declares its canonical unit, granularity and the capability that serves it.
The planner derives which capabilities to call from the metrics the applicable activities
declare. Nothing in the code states that surfing needs marine data.

**Alternative rejected: a per-activity list of required endpoints.** Direct and readable,
and it puts vendor topology into the activity declaration — so adding a source that
serves waves inside the forecast endpoint would require editing every activity.

### Decision 3: Conversion lives in the vendor mapper, and only there

The three conversions stage 3 identified (km/h → m/s, m → km for visibility, snow kept in
its recorded units) happen while mapping a raw response. Beyond the mapper the canonical
unit is part of the value's type.

**Alternative rejected: converting in the scoring engine, where thresholds are read.** It
keeps adapters trivial and spreads unit knowledge across every threshold in every activity
declaration — the single place where a 100× snow error is most expensive.

### Decision 4: Failures are values with stable codes

Ports return a result type. The fixed code set covers transport, timeout, status,
unexpected content type, malformed body and schema mismatch. The source's own message is
logged and never returned, because stage 3 recorded one that was factually wrong and one
that contained an internal type name.

**Alternative rejected: throwing typed exceptions.** Idiomatic in Nest and interoperable
with its exception filters. It also makes the failure path invisible in the type of a
domain function, and the domain is the half of this system that must never surprise us.

### Decision 5: Interchangeability is proven by a shared suite

One conformance suite is parameterised by a port factory and runs against every adapter,
mock included.

**Alternative rejected: per-adapter tests written by whoever adds the adapter.** Cheaper
per adapter, and it guarantees the second source is tested for different properties than
the first — which is precisely when "interchangeable" stops being true.

### Decision 8: The place-lookup seam is here, its meaning is not

The lookup port, its response validation and its failure mapping live with the other
source seams; interpreting the result stays in `location-applicability`.

**Alternative rejected: declaring the lookup port in `location-applicability`.** It puts
the port beside the behaviour that uses it, which reads better. It also creates a cycle:
the recorded sources implement every port and are needed by `location-applicability`'s own
fixture-based tests, while that change would define a port the recorded sources must
implement first. Splitting seam from meaning removes the cycle.

### Decision 6: Provider selection moves out of the mock change

Which source is bound, how that is reported and what happens for an unimplemented value
are properties of the seam, not of the mock.

**Alternative rejected: leaving the requirement in `weather-mock-data`.** It would place a
general rule inside a capability about fixtures, so the live adapter's change would have
to modify a mock spec to state how the live source is selected.

## Risks / Trade-offs

- **Three ports where one existed → more scaffolding before the first byte is fetched.**
  Mitigation: the ports share one request shape and one result shape; the difference is
  the capability tag and the TTL that the caching change attaches to it.
- **The conformance suite can ossify into vendor-specific assumptions.** Mitigation: the
  suite asserts contract properties only — units, gaps, provenance, failure kinds — and
  never a specific vendor's field names.
- **The metric dictionary becomes a bottleneck every metric must pass through.**
  Mitigation: that is the intent; the cost is one entry per metric and it is what makes
  "add a metric" a two-file change.
- **A router able to choose a source per metric is more generality than one vendor
  justifies.** Mitigation: the interface allows it, the first implementation is a table of
  three rows, and the generality is exercised only when a second source appears.

## Open Questions

- Whether archive access belongs to this capability or to `location-applicability`, which
  is its only consumer. Kept here because it returns a time series with the same shape and
  the same unit traps; moving it later would not change any requirement above.
- Whether `MAPPER_VERSION` (the cache-namespace guard from stage-four.md §5.4) is declared
  here or in the caching change. **Resolved:** it is declared with the mappers in
  `06-add-open-meteo-source` (Decision 8 there) and consumed by the key builder in
  `07-add-source-caching-and-resilience`. A version that lives away from the thing it
  versions is a version nobody remembers to raise.
