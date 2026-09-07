## 1. Location resolution

- [ ] 1.1 Write a failing test for coordinate rounding and identity derivation, then add
      `src/domain/shared/coordinates.ts`; test that two points within the grid share an
      identity and that identity is stable across processes.
- [ ] 1.2 Consume the place-lookup port from `01-add-weather-source-contract`; test that an
      empty lookup result is turned into the not-found reason here, in the resolver, rather
      than at the port.
- [ ] 1.3 Write failing tests, then add the location resolver: name or coordinates → a
      resolved location with coordinates, time zone, elevation and administrative context.
- [ ] 1.4 Test the ambiguous-name case: the most populous candidate is chosen and the
      chosen place's country and region are reported.
- [ ] 1.5 Test that three spellings of one city resolve to one identity.
- [ ] 1.6 Test that out-of-range coordinates fail before any outbound call, and that an
      unknown name fails with the not-found reason without substitution.

## 2. Profile store and rules registry

- [ ] 2.1 Add the profile store port with an in-memory implementation; test that a second
      request for a profiled location performs no evidence calls.
- [ ] 2.2 Add the applicability rule registry that declarations reference by name; test
      that an unknown rule name fails at declaration load.
- [ ] 2.3 Test that the profile records evidence, decision source and rules version, and
      that a rules-version bump marks existing profiles outdated.

## 3. Marine probe

- [ ] 3.1 Write failing tests, then implement the probe: one variable, one day, resolved
      against the marine port.
- [ ] 3.2 Test: an all-null probe records a candidate and yields missing data, marked
      retryable — not inapplicable.
- [ ] 3.3 Test: a second all-null probe dated a different day confirms the no-coastline
      reason.
- [ ] 3.4 Test: a probe returning values clears an existing candidacy.
- [ ] 3.5 Test: a transport failure during probing creates no candidacy at all.
- [ ] 3.6 Test: a location with a probe record from today is not probed again.
- [ ] 3.7 Test the lake fixture: it follows the same path and ends inapplicable once
      confirmed.

## 4. Snow-season evidence

- [ ] 4.1 Write failing tests, then implement cold-season snowfall classification from the
      archive port, evaluating both candidate cold months and taking the larger total.
- [ ] 4.2 Test with recorded archive fixtures: an alpine location has a season, a
      Mediterranean coastal city does not.
- [ ] 4.3 Test the equatorial high-elevation case: no season despite the elevation.
- [ ] 4.4 Test the low-elevation arctic case: a season despite the elevation.
- [ ] 4.5 Test the southern-hemisphere case: applicable, decided by data rather than by
      month.
- [ ] 4.6 Test the archive-unavailable path: the heuristic is used and the profile is
      marked heuristic.

## 5. Effect on the weather request

- [ ] 5.1 Test that an inapplicable activity's exclusive metrics are absent from the
      resulting metric plan.
- [ ] 5.2 Test that an inland location produces no marine plan item at all.
- [ ] 5.3 Test that activities declaring no applicability rule are applicable everywhere
      and trigger no evidence call.

## 6. Close-out

- [ ] 6.1 Confirm every acceptance case of stage-two.md §12 that concerns applicability
      has a test with the same name.
- [ ] 6.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste
      the output.
- [ ] 6.3 Write the ADR "Surfing applicability by a two-phase marine probe" under
      `docs/adr/`, recording the coastline-dataset fallback.
- [ ] 6.4 `/code-review` at level `high`, then `/opsx:archive`.
