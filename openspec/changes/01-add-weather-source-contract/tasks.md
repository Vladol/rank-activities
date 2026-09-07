## 1. Domain foundations

- [ ] 1.1 Add `src/domain/shared/result.ts` with `Result<T, E>`; verify with a unit test
      that a failure carries its error and that no helper throws.
- [ ] 1.2 Add `src/domain/shared/domain-error.ts` and the weather error code set from
      design.md Decision 4; test that each code is distinct and stable.
- [ ] 1.3 Write a failing test asserting every metric in stage-three.md §4 has a canonical
      unit, a granularity and a serving capability, then add
      `src/domain/weather/metric.ts` with the metric dictionary.
- [ ] 1.4 Add `src/domain/weather/units.ts` with the canonical units and converters;
      test km/h → m/s and m → km, and test that snowfall and snow depth are NOT converted.
- [ ] 1.5 Write a failing test constructing a series with gaps, then add
      `src/domain/weather/weather-series.ts` (`WeatherSeries`, hourly and daily channels,
      provenance, grid point).
- [ ] 1.6 Add `mergeSeries`; test that two series from different capabilities combine,
      that both provenance entries survive, and that a metric collision is reported rather
      than silently overwritten.
- [ ] 1.7 Run `npm run lint` and confirm nothing under `src/domain/**` imports Nest or
      infrastructure.

## 2. Ports and request shape

- [ ] 2.1 Add `src/modules/weather/ports/contracts.ts`: `SeriesRequest`, `WeatherError`,
      `Capability`; verify `npx tsc --noEmit` passes with no `any`.
- [ ] 2.2 Add the three capability ports and their DI tokens in
      `src/modules/weather/ports/`; no implementations yet.
- [ ] 2.2a Add the place-lookup port, its response schema and its DI token; test that a
      successful response with no matches parses as an empty result rather than a failure.
- [ ] 2.3 Write a failing test, then implement horizon validation that rejects a request
      exceeding the source's declared maximum before any call is attempted.

## 3. Conformance suite

- [ ] 3.1 Add `src/modules/weather/contract/weather-port.conformance.ts` exporting a
      parameterised suite; verify it fails loudly when given a port that returns raw
      source units.
- [ ] 3.2 Cover in the suite: canonical units per metric; `supports` agrees with what
      `fetch` accepts; gaps preserved in count and position; an all-null series is present
      but empty; provenance carries the grid point from the response.
- [ ] 3.3 Cover the failure cases from stage-three.md §6: empty 200 body, HTML 403,
      JSON 400, timeout — each yields a typed failure and never a throw.
- [ ] 3.4 Add a suite assertion that the source's own error text never appears in the
      returned error, only in the log record.

## 4. Metric planning and source selection

- [ ] 4.1 Write failing tests, then add `metric-planner.service.ts`: metrics of applicable
      activities → deduplicated request per capability.
- [ ] 4.2 Test: a location without an applicable marine activity produces no marine plan
      item at all (assert on the plan, not on a network mock).
- [ ] 4.3 Test: a derived metric expands into its inputs and does not appear in the
      outgoing request.
- [ ] 4.4 Add `source-router.service.ts` with the static capability-to-source table; test
      that an unbound capability is an explicit error.
- [ ] 4.5 Move provider selection out of the mock change into
      `weather.module.ts`: bind per capability from configuration, log the bound source,
      exit non-zero for a declared-but-unimplemented source.
- [ ] 4.6 Test: startup fails with a message naming the unimplemented source, and does not
      fall back.

## 5. Alignment with the pending mock change

- [ ] 5.1 Verify the amendment already made to `openspec/changes/02-add-mock-weather-provider/`
      still holds: it consumes these ports and types, defines no port of its own, and
      carries no provider-selection requirement.
- [ ] 5.2 Verify `openspec validate --strict` passes for both changes.

## 6. Close-out

- [ ] 6.1 Write the ADR "Capability ports instead of one weather provider port" under
      `docs/adr/`, and link it from `docs/development-flow/stage-four.md` §5.1.
- [ ] 6.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste
      the output.
- [ ] 6.3 `/code-review` at level `high`, then `/opsx:archive`.
