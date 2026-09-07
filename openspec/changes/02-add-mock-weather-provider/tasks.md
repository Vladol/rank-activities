## 1. Prerequisites from the source contract

- [ ] 1.1 Confirm `01-add-weather-source-contract` is applied: metric dictionary, canonical
      units, `WeatherSeries`, `Result`, the three capability ports and the place-lookup
      port exist; `npx tsc --noEmit` passes against them.
- [ ] 1.2 Confirm the shared source conformance suite is available to run against the
      recorded sources.
- [ ] 1.3 Map each recorded failure fixture onto an existing error code from the contract's
      code set; add none of your own.
- [ ] 1.4 Verify the recorded sources declare the capabilities and metrics they can serve
      from the fixture manifest, rather than claiming support for everything.
- [ ] 1.5 Verify the linter still rejects a `@nestjs/*` import from `src/domain/**`
      (`npm run lint` on a throwaway file, then delete it).

## 2. Fixtures recorded from the live API

- [ ] 2.1 Add `scripts/record-fixture.ts`: takes a name and a URL, writes the raw body to
      the fixture directory, appends the manifest entry (URL, capture date, HTTP status,
      content type).
- [ ] 2.2 Make it refuse to overwrite an existing fixture without `--force`, and report
      key-level differences when it would.
- [ ] 2.3 Record the success fixtures from `docs/investigation/open-meteo/requests.md`:
      `lisbon-surf`, `chamonix-winter-ski` (archive, January), `queenstown-nz-ski`,
      `prague-inland`, `london-rainy`, `tromso-arctic`, `marine-lisbon`,
      `marine-prague-inland`, `marine-geneva-lake`, `geocoding-lisbon`,
      `geocoding-moscow-ambiguous`.
- [ ] 2.3a Record from the archive the cases that today's weather cannot supply, each of
      which is the only test of a specific rule: `dubai-heat` (July, +45 °C and clear —
      the case that forced limiting features), `chamonix-summer` (season is not
      applicability), `tromso-polar-night` (December, zero daylight — indoor must not be
      zeroed), `storm-gusts` (gusts above 25 m/s — the cross-cutting constraint),
      `marine-odessa-flat` (a flat sea is not an absent sea) and `quito-highland`
      (elevation without a snow season).
- [ ] 2.4 Record the failure fixtures: `error-bad-latitude` (400 + JSON),
      `error-empty-body` (200 + zero bytes), `error-html-403` (403 + HTML),
      `geocoding-not-found` (200, no `results` key).
- [ ] 2.5 Confirm the archive fixture really carries the ERA5 nulls the null-policy tests
      depend on: `visibility` and `freezing_level_height` null in all 168 slots.

## 3. Zod schema for the Open-Meteo envelope

- [ ] 3.1 Write a failing test parsing `lisbon-surf`, then add
      `src/modules/weather/adapters/open-meteo/open-meteo.schema.ts`.
- [ ] 3.2 Test: `*_units` are validated against the expected values, and a mismatch is a
      parse failure (guards the silent `temperature_unit` corruption from
      stage-three.md §2.4).
- [ ] 3.3 Test: `null` inside an hourly array parses; a missing array does not.
- [ ] 3.4 Test: the lookup schema from the contract treats `results` as optional, so the
      `geocoding-not-found` fixture parses as an empty result rather than a failure.
- [ ] 3.5 Test: every recorded fixture parses. Drive it from the manifest so a new
      fixture is covered automatically.

## 4. Raw → domain mapper

- [ ] 4.1 Write failing tests for the three unit conversions, then add
      `open-meteo.mapper.ts`: `wind_speed_10m` km/h → m/s, `visibility` m → km,
      `snowfall` stays cm while `snow_depth` stays m.
- [ ] 4.2 Test: naive ISO timestamps are not parsed as UTC — the offset comes from
      `utc_offset_seconds`.
- [ ] 4.3 Test: `null` in a series maps to an absent value, not to `0`.
- [ ] 4.4 Test: mapping `marine-prague-inland` yields a series that is present but
      entirely empty of values, distinguishable from a missing series.

## 5. Time-axis rebaser

- [ ] 5.1 Write failing tests, then add `time-axis-rebaser.ts` as a pure function
      `(rawBody, today) => rawBody`.
- [ ] 5.2 Test: a September fixture served on a December date shifts to that date,
      preserving 168 entries, all values and all nulls.
- [ ] 5.3 Test: time-of-day survives (`T14:00` stays `T14:00`); `timezone`,
      `timezone_abbreviation` and `utc_offset_seconds` are untouched.
- [ ] 5.4 Test: `daily.time[n]` still matches hours 24n…24n+23 of `hourly.time`, and
      `sunrise`/`sunset` shift by the same number of days.
- [ ] 5.5 Test: two calls with the same date are byte-identical.

## 6. Fixture registry and the mock provider

- [ ] 6.1 Write failing tests, then add `fixture-registry.ts`: manifest loaded once at
      startup, lookup by `lat.toFixed(2):lon.toFixed(2)`.
- [ ] 6.2 Test: an exact coordinate and a nearby coordinate that rounds the same resolve
      to the same fixture.
- [ ] 6.3 Test: an uncovered coordinate returns an error naming the missing fixture and
      the key that would identify it — no nearest-neighbour fallback.
- [ ] 6.4 Test: a fixture file with no manifest entry, and a manifest entry with no file,
      both fail startup.
- [ ] 6.5 Add the recorded source implementations wiring registry → rebaser → schema →
      mapper behind each capability port and behind the place-lookup port, then run the
      shared conformance suite on them.
- [ ] 6.6 Test: an error fixture yields the recorded status, content type and body, and
      the provider surfaces a `WeatherError` rather than throwing.

## 7. Wiring and the environment

- [ ] 7.1 Register the recorded sources in `weather.module.ts` as the development default,
      using the selection mechanism from `01-add-weather-source-contract`.
- [ ] 7.2 Confirm the unimplemented-source rejection specified by `weather-sources` covers
      `record`, and that its message points at `scripts/record-fixture.ts`.
- [ ] 7.3 Test: with no source configured the recorded sources are bound, and startup logs
      the fixture count.
- [ ] 7.4 Update `.env.example` so the source comment matches the capability-based
      selection introduced by `01-add-weather-source-contract`.

## 8. No-network guarantee

- [ ] 8.1 Add a vitest setup file that fails any test making an outbound connection.
- [ ] 8.2 Verify it works: a throwaway test that fetches a URL must fail, then delete it.
- [ ] 8.3 Run the whole suite with networking disabled and confirm it is green.

## 9. Documentation and close-out

- [ ] 9.1 Write `docs/requirements/mocking.md`: the strategy, the fixture table, how to
      add a fixture, and what is deliberately deferred (`record`, generator, contract
      test, `msw`).
- [ ] 9.2 Link it from `flow.md` §2.4 and from `CLAUDE.md`.
- [ ] 9.3 Resolve the `/docs` gitignore question (design.md, Decision 6) before relying
      on any docs path from code or CI.
- [ ] 9.4 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and
      paste the output; then `/code-review` at level `high`.
- [ ] 9.5 `/opsx:archive` the change.
