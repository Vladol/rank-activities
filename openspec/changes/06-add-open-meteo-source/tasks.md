## 1. Transport

- [ ] 1.1 Add `src/modules/weather/adapters/open-meteo/open-meteo.http.ts` with an explicit
      `undici` `Agent`: connection reuse, separate connect / headers / body timeouts.
      Install `undici` with this task, not before.
- [ ] 1.2 Write a failing test against a local server that responds `403` with an HTML body,
      then implement content-type classification; assert no parse is attempted.
- [ ] 1.3 Write a failing test for a `200` with a zero-byte body, then implement the
      empty-body check before `JSON.parse`; assert the failure is distinguishable from a
      malformed body.
- [ ] 1.4 Write a failing test for `429` with and without `Retry-After`, then implement
      status-only classification; assert the body is never read.
- [ ] 1.5 Test that a second request to the same host reuses the connection.
- [ ] 1.6 Test that the response is transferred compressed and that the schema validates the
      decoded body — stage-three.md §7.2 warns that explicit headers can disable automatic
      decoding.
- [ ] 1.7 Test that a host which accepts and never answers fails within the configured
      timeout, not at the system default. This is the measurement stage-six.md §9.2 asks for.

## 2. Forecast capability

- [ ] 2.1 Add `forecast/variables.ts`: `MetricCode` → vendor variable name, hourly and daily.
- [ ] 2.2 Write failing schema tests against `samples/forecast-lisbon-full.json` and
      `forecast-minimal-3vars.json`, then add `forecast/schema.ts` with exact `*_units`
      assertions.
- [ ] 2.3 Test that `forecast-units-imperial.json` is REJECTED by the schema, naming the
      variable and both units — this is the silent-corruption case from stage-three.md §2.4.
- [ ] 2.4 Add `forecast/mapper.ts`; test the three conversions (km/h → m/s, m → km) and test
      that snowfall and snow depth are not converted.
- [ ] 2.5 Test that `null` inside an hourly series survives mapping as `null`, position and
      count preserved, against `archive-chamonix-hourly-jan.json`.
- [ ] 2.6 Test that the provenance carries the response's coordinates and elevation, not the
      requested ones, against `forecast-chamonix-elev2500.json`.

## 3. Marine, archive and place lookup

- [ ] 3.1 Add the marine triple; test that `marine-prague-inland.json` maps to a present
      series of nulls, not to a failure and not to an empty series.
- [ ] 3.2 Add the archive triple; test that a January archive response maps identically to a
      forecast response of the same shape.
- [ ] 3.3 Add the geocoding implementation; test against `geocoding-not-found.json` that a
      missing `results` key parses as an empty result rather than a failure.
- [ ] 3.4 Test against `geocoding-moscow-ambiguous.json` that every candidate crosses the
      port unranked — selection belongs to `location-applicability`.
- [ ] 3.5 Test against `error-bad-latitude.json` and `error-horizon-too-large.json` that the
      vendor's `reason` text never appears in the returned error, only in the log.

## 4. Admission and containment

- [ ] 4.1 Run the shared conformance suite against all four live implementations; make it
      pass without editing the suite.
- [ ] 4.2 Add a test that greps the source tree for the vendor's variable names outside
      `adapters/open-meteo/**` and fails on any hit.
- [ ] 4.3 Declare `MAPPER_VERSION` beside the mappers; test that it is exported and that the
      value is a single source of truth (design.md Decision 8, resolving the open question
      in `01/design.md`).
- [ ] 4.4 Bind `open-meteo` in `weather.module.ts` per capability; test that a capability the
      vendor does not declare refuses the start.

## 5. Recording mode

- [ ] 5.1 Add `adapters/record/`: the live source plus a writer decorator; test that the
      caller receives the same result it would receive from the live source alone.
- [ ] 5.2 Test that a fixture is written with its request URL and recording time, and that
      the manifest entry is added.
- [ ] 5.3 Test that an existing fixture is not overwritten unless replacement is explicitly
      requested, and that the refusal names the fixture.
- [ ] 5.4 Test that recording is never selected by default.
- [ ] 5.5 Update `docs/requirements/mocking.md`: the recording procedure now has a live path
      beside the script.

## 6. Live contract test

- [ ] 6.1 Add `test/contract/open-meteo.live.spec.ts` validating one live response per
      capability with the adapter's own schemas.
- [ ] 6.2 Exclude it from `npm test` and `npm run test:e2e`; verify both runs make no
      outbound connection with the socket guard from `02`.
- [ ] 6.3 Add the scheduled invocation and document it in `README.md`.
- [ ] 6.4 Verify the failure message names the diverging field and states that fixtures and
      mapper need updating.

## 7. Close-out

- [ ] 7.1 Note in `README.md` that the free tier forbids commercial use and that the
      commercial host differs by hostname and one parameter.
- [ ] 7.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste
      the output.
- [ ] 7.3 `/security-review` — this change introduces the first outbound HTTP client and the
      first code that writes files at runtime.
- [ ] 7.4 `/code-review` at level `high`, then `/opsx:archive`.
