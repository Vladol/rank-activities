## 1. Outcome model and ordering

- [ ] 1.1 Write failing tests, then add the outcome types in `src/domain/ranking/`: ranked,
      inapplicable and missing-data, each with the fields its requirement names.
- [ ] 1.2 Test that a ranked zero carries a constraint reason and is not representable as
      inapplicable, and that an inapplicable outcome cannot carry a score.
- [ ] 1.3 Write failing tests, then add ordering: descending by score, non-scored outcomes
      excluded and grouped, ties broken by activity code.
- [ ] 1.4 Test ordering determinism by evaluating a tied input repeatedly.

## 2. Days and windows

- [ ] 2.1 Write failing tests, then derive day windows from a series: local date per day,
      the day's actual hour count, and its daylight hours taken from the series.
- [ ] 2.2 Test a polar-night fixture: zero daylight hours is a valid window and produces no
      arithmetic error anywhere downstream.
- [ ] 2.3 Test a far-offset location fixture: local dates match the source's own labels and
      do not shift by a day.
- [ ] 2.4 Implement the per-day completeness declaration and test that it reports what was
      actually computed.

## 3. Request validation

- [ ] 3.1 Write a failing test, then validate the horizon before any outbound work; assert
      no plan is built and no call is attempted for an over-long horizon.
- [ ] 3.2 Test that an omitted horizon uses the configured default and that the answer
      states the days covered.

## 4. Orchestration

- [ ] 4.1 Write failing tests, then add the ranking use case wiring resolution →
      applicability → declarations → metric plan → fetch → day windows → scoring →
      ordering.
- [ ] 4.2 Implement concurrent fetching that settles items individually; test that one
      failing plan item leaves the others' results intact.
- [ ] 4.3 Test that every catalogue activity appears exactly once per day.
- [ ] 4.4 Test that a total data failure still returns a resolved location, a time zone and
      per-activity missing-data outcomes.
- [ ] 4.5 Assemble answer metadata: resolved place, obtained-at, stale flag, profile
      version, time zone; test each is present and truthful.
- [ ] 4.6 Add the scope statement to the answer and test its presence.

## 5. Acceptance cases from stage 2

- [ ] 5.1 Turn each acceptance case of `docs/development-flow/stage-two.md` §12 into a test
      with the same name, running against recorded fixtures.
- [ ] 5.2 Cover the four distinguishable answers explicitly: inland surfing, flat-sea
      surfing, good surfing, unavailable marine source.
- [ ] 5.3 Cover the seasonal case: a snow location out of season is a ranked zero, not
      inapplicable.
- [ ] 5.4 Cover the inversion cases: a week of rain puts the indoor activity first; extreme
      heat with clear skies puts it above the outdoor one.
- [ ] 5.5 Cover the cross-cutting constraint: a storm zeroes all four activities.
- [ ] 5.6 Cover the gap case: a day above the gap threshold reports missing data while the
      other days are scored.
- [ ] 5.7 Cover the selective constraint: on a day with no daylight the outdoor activities
      are ranked zeroes with that reason while the indoor one is scored on its merits and
      ranks first, with no non-numeric score anywhere in the answer.
- [ ] 5.8 Mark the two deferred cases (partial current day, daylight-saving transition) as
      skipped with a reference to ТД-01.

## 6. API surface

- [ ] 6.1 Add the result models and mappers so the domain outcome union is exposed without
      domain types crossing the boundary; test that renaming a domain field does not change
      the exposed shape.
- [ ] 6.2 Add an end-to-end test through the API against the mock source covering one
      coastal and one inland location.

## 7. Close-out

- [ ] 7.1 Verify every functional requirement of stage-two.md §9 is covered by a test,
      except those marked deferred; list the mapping in the change notes.
- [ ] 7.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste
      the output.
- [ ] 7.3 `/code-review` at level `high`, then `/opsx:archive`.
