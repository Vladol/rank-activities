## 1. Location resolution

- [x] 1.1 Write a failing test for coordinate rounding and identity derivation, then add
      `src/domain/shared/coordinates.ts`; test that two points within the grid share an
      identity and that identity is stable across processes.
- [x] 1.2 Consume the place-lookup port from `01-add-weather-source-contract`; test that an
      empty lookup result is turned into the not-found reason here, in the resolver, rather
      than at the port.
- [x] 1.3 Write failing tests, then add the location resolver: name or coordinates → a
      resolved location with coordinates, time zone, elevation and administrative context.
- [x] 1.4 Test the ambiguous-name case: the most populous candidate is chosen and the
      chosen place's country and region are reported.
- [x] 1.5 Test that three spellings of one city resolve to one identity. *Asserted on
      Lisbon rather than on stage two's Munich / München: the recorded München response is
      the nginx 403 of stage-three.md §6, a transport case rather than a spelling one.*
- [x] 1.6 Test that out-of-range coordinates fail before any outbound call, and that an
      unknown name fails with the not-found reason without substitution.

## 2. Profile store and rules registry

- [x] 2.1 Add the profile store port with an in-memory implementation; test that a second
      request for a profiled location performs no evidence calls.
- [x] 2.2 Add the applicability rule registry that declarations reference by name; test
      that an unknown rule name fails at declaration load. *Already delivered by
      `03-add-activity-declaration-model` (`declaration.load.ts`, `applicability.registry.ts`);
      this change adds `APPLICABILITY_RULES_VERSION` beside it.*
- [x] 2.3 Test that the profile records evidence, decision source and rules version, and
      that a rules-version bump marks existing profiles outdated.

## 3. Marine probe

- [x] 3.1 Write failing tests, then implement the probe: one variable, one day, resolved
      against the marine port.
- [x] 3.2 Test: an all-null probe records a candidate and yields missing data, marked
      retryable — not inapplicable.
- [x] 3.3 Test: a second all-null probe dated a different day confirms the no-coastline
      reason.
- [x] 3.4 Test: a probe returning values clears an existing candidacy.
- [x] 3.5 Test: a transport failure during probing creates no candidacy at all.
- [x] 3.6 Test: a location with a probe record from today is not probed again.
- [x] 3.7 Test the lake fixture: it follows the same path and ends inapplicable once
      confirmed.

## 4. Snow-season evidence

- [x] 4.1 Write failing tests, then implement cold-season snowfall classification from the
      archive port, evaluating both candidate cold months and taking the larger total.
- [x] 4.2 Test with recorded archive fixtures: an alpine location has a season, a
      Mediterranean coastal city does not. *Needed twelve new whole-month climate
      recordings: every archive fixture on disk was a seven-day scoring window, and the
      threshold is 20 cm over a cold **month**.*
- [x] 4.3 Test the equatorial high-elevation case: no season despite the elevation.
- [x] 4.4 Test the low-elevation arctic case: a season despite the elevation.
- [x] 4.5 Test the southern-hemisphere case: applicable, decided by data rather than by
      month. *Asserted on Perisher, 1 743 m, rather than on stage two's Queenstown: the
      archive at the Queenstown town centre, 322 m, records 1.4 cm across July 2025 — the
      ski fields are a different point, and stage-two.md §11 keeps a location a point.*
- [x] 4.6 Test the archive-unavailable path: the heuristic is used and the profile is
      marked heuristic.

## 5. Effect on the weather request

- [x] 5.1 Test that an inapplicable activity's exclusive metrics are absent from the
      resulting metric plan.
- [x] 5.2 Test that an inland location produces no marine plan item at all.
- [x] 5.3 Test that activities declaring no applicability rule are applicable everywhere
      and trigger no evidence call.

## 6. Close-out

- [x] 6.1 Confirm every acceptance case of stage-two.md §12 that concerns applicability
      has a test with the same name. *`test/acceptance/applicability.spec.ts`, one `it` per
      row. The rows about scoring a place already decided possible — Odessa's flat sea,
      Chamonix in summer — are asserted here only for the half this change owns: that
      neither is answered with `NotApplicable`.*
- [x] 6.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste
      the output. *`oxlint` clean, `tsc --noEmit` clean, 694 unit tests in 53 files, 7 e2e
      tests in 4 files, all passing.*
- [x] 6.3 Write the ADR "Surfing applicability by a two-phase marine probe" under
      `docs/adr/`, recording the coastline-dataset fallback. *`docs/adr/0008-two-phase-marine-probe.md`,
      indexed in `docs/adr/README.md`.*
- [x] 6.4a `/code-review` at level `high`. Seven findings, all fixed, each with a test that
      fails without the fix:
      1. `GeoModule` and `AppModule` both called `WeatherModule.forRoot()`, and Nest keys a
         dynamic module by the returned object — two sets of ports, the binding log twice.
         `forRoot` now returns one module per configuration.
      2. A *failed* marine probe did not advance `lastProbedOn`, so an outage was probed
         once per request. It now records the attempt without recording a candidacy.
      3. An archive month that came back present-but-empty summed to 0 cm and settled
         `NO_SNOW_SEASON` permanently. An all-null grid is now no reading, the same way the
         marine probe reads one.
      4. A heuristic profile was pinned forever. It is retried once a day, and the
         evidence records the day it was attempted on.
      5. A rules-version bump discarded the evidence, contradicting Decision 4. Verdicts are
         derived on every read, so a bump now re-stamps the profile and fetches nothing.
      6. `computedAt` was refreshed and the profile re-saved on every request. A request
         that changes nothing now returns the stored profile untouched.
      7. `allNullProbeDates` was documented as local dates while the code wrote UTC.
- [ ] 6.4b `/opsx:archive`.

## 7. Carried out of this change

- [ ] 7.1 **`08-add-data-persistence` remains the prerequisite for completing this change.**
      The profile store is in-memory, so an unconfirmed marine candidacy cannot survive to
      the second day across a restart. Swapping the store is one line in `GeoModule`.
- [ ] 7.2 The geocoder answers 38.72509, -9.1498 for Lisbon, which rounds to the grid key
      `38.73,-9.15`; every Lisbon series recording was made at 38.7167, -9.1333, or
      `38.72,-9.13`. A name therefore resolves but has no recorded weather behind it.
      Recording the series for the geocoded points belongs to `06-add-open-meteo-source`.
