## Context

`01-add-weather-source-contract` owns the ports, the metric dictionary, the canonical units
and the conformance suite; `02-add-mock-weather-provider` implements those ports from
recorded responses. This change adds the second implementation — the one that actually
fetches. It is the first place in the service where a socket is opened, and the first place
where a third party's vocabulary appears.

Implementation order: after `02` at the earliest, because the adapter is checked against
recorded responses; before `07-add-source-caching-and-resilience`, because the decorators
wrap this adapter and the cache namespace is versioned by this adapter's mapper.

Everything asserted below was observed in stage 3 against the live API and is stored under
`docs/investigation/open-meteo/samples/`. No failure mode here is hypothetical.

## Goals / Non-Goals

**Goals:**

- The live source and the recorded source are interchangeable in fact, not by intention:
  one suite admits both.
- Every stage 3 surprise is absorbed in the vendor package, so nothing further in has to
  know that Open-Meteo exists.
- A fixture that stops describing the live API is detected by a test rather than by a wrong
  answer in production.

**Non-Goals:**

- Resilience and caching. The adapter has one timeout per attempt and nothing else; retries,
  the breaker, the limiter and the cache are `07`.
- Choosing which metrics to fetch. The planner in `weather-sources` decides; the adapter
  translates and asks.
- Multi-vendor composition. The router already allows it; this change ships one vendor.

## Decisions

### Decision 1: One vendor package, four hosts

Forecast, marine, archive and geocoding live on four different hosts with one envelope
shape. They ship as one package with a shared transport and per-capability
`variables` / `schema` / `mapper` triples.

**Alternative rejected: a package per host.** It matches the deployment reality of the
vendor and duplicates the transport, the unit assertion and the failure mapping four times —
which is precisely where a divergence would be invisible, because each copy would keep
passing its own tests.

### Decision 2: `undici` with an explicit `Agent`, not the global `fetch`

The transport constructs its own dispatcher with connection reuse and separate connect,
headers and body timeouts.

**Alternative rejected: the built-in global `fetch`.** No dependency, familiar API. It keeps
its own internal dispatcher, so pool and keep-alive settings applied globally would be an
illusion — and 20 % of the observed 136 ms is connection setup on a path that makes two
calls for every coastal location. Stage 6 §9.2 records this as a claim to verify by test,
not by reasoning, and task 2.5 below is that test.

### Decision 3: Units are asserted, never requested

The adapter sends no `temperature_unit`, `wind_speed_unit` or `precipitation_unit`, and
validates each `*_units` field against the metric dictionary's expectation.

**Alternative rejected: requesting canonical units directly** (`wind_speed_unit=ms`), which
would remove the conversion step entirely. Rejected on failure mode: a request parameter
that is ignored, renamed or silently unsupported returns values under an unchanged field
name, and the only witness would be the `*_units` field we would then have no reason to
read. Asserting a unit fails loudly; requesting one fails quietly. The recorded fixtures
were also captured without unit parameters, so requesting them would make the two
implementations disagree about what a fixture means.

### Decision 4: The body is classified before it is parsed

Status, `content-type` and length are examined first; `JSON.parse` runs only on a body that
survived all three.

**Alternative rejected: parse first, catch the exception.** Shorter, and it collapses four
distinguishable failures — an HTML error page, an empty body, a structured API error and a
schema mismatch — into one `SyntaxError` that names none of them. Stage 3 observed all four.

### Decision 5: `429` is decided by status and `Retry-After`, never by body

The rate-limited response's body shape was not captured, because capturing it means
violating the limit that protects the free tier.

**Alternative rejected: parsing the limit response for a structured reason.** It would give
a better log line, and it would be built on an assumption that cannot be tested without
misusing the source — the one class of assumption this project has refused everywhere else.

### Decision 6: The recording mode is a decorator, not a third source

`record` binds the live adapter and attaches a writer that persists the raw response, its
request URL and a manifest entry.

**Alternative rejected: a separate `record` source implementation.** It reads more directly
in the module wiring. It also duplicates the live adapter, so a fixture could be recorded
through a code path that differs from the one it is later meant to describe — which would
make the fixture set quietly wrong in exactly the way it exists to prevent.

### Decision 7: The live contract test runs on a schedule, not in the default suite

It is excluded from `npm test` and `npm run test:e2e`, and runs nightly and on demand.

**Alternative rejected: running it in CI with everything else.** It would catch a vendor
change at the earliest moment. It would also make every build depend on a third party's
uptime and spend the daily quota on pull requests, and FR-23 — development and the full
suite without a network — would become false. A red scheduled run is a task; a red build is
a blocked team.

### Decision 8: `MAPPER_VERSION` is declared with the mappers

`01/design.md` left open whether the cache-namespace guard belongs to the contract or to the
caching change. It is defined here, beside the code whose behaviour it describes, and
imported by the key builder in `07`.

**Alternative rejected: declaring it in the caching change.** The constant is consumed
there, which is an argument for keeping it there. It is *invalidated* by an edit to a mapper,
and a version that lives away from the thing it versions is a version nobody remembers to
raise.

## Risks / Trade-offs

- **This is the only component whose correctness depends on a third party's stability.**
  Mitigation: the scheduled contract test, and a schema strict enough that a shape change
  fails validation instead of producing a plausible number.
- **Asserting `*_units` makes a harmless vendor change (a renamed unit string) an outage.**
  Accepted, and preferred to the alternative: the failure is loud, immediate, and names the
  field. The scheduled test sees it before a user does.
- **`undici` is a direct dependency that Node already ships internally.** Cost: one package,
  and an upgrade path tied to it. Bought: pool and timeout settings that actually apply.
- **gzip is claimed but not guaranteed.** Compression is 5.6× on these payloads, and
  explicitly setting request headers can disable the automatic handling. Covered by a test
  that asserts on the decoded body and the response encoding, not by trust.
- **The recording mode writes files from a running service.** Bounded: it is refused unless
  explicitly selected, writes only under the fixtures directory, and never overwrites
  silently — `weather-mock-data` already requires the last part.

## Open Questions

- Whether the archive capability should request only the cold-month window it needs or a
  full year at once. A year is ~14 KB and one call instead of two; the narrow window is what
  `location-applicability` actually consumes. Decided at implementation, changes no
  requirement.
- Whether a `429` should surface as its own reason code or share `PROVIDER_BUSY` with the
  outbound budget's shedding decision in `07`. They mean the same thing to a client and
  different things to an operator.
- Whether the elevation endpoint is worth binding for the raw-coordinates input path, or
  whether the forecast response's own elevation is sufficient. Stage 3 §1 leans to the
  latter; `location-applicability` is the only consumer.
