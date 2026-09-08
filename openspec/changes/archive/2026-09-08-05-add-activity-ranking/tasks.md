## 1. Outcome model and ordering

- [x] 1.1 Write failing tests, then add the outcome types in `src/domain/ranking/`: ranked,
      inapplicable and missing-data, each with the fields its requirement names.
- [x] 1.2 Test that a ranked zero carries a constraint reason and is not representable as
      inapplicable, and that an inapplicable outcome cannot carry a score.
- [x] 1.3 Write failing tests, then add ordering: descending by score, non-scored outcomes
      excluded and grouped, ties broken by activity code.
- [x] 1.4 Test ordering determinism by evaluating a tied input repeatedly.

## 2. Days and windows

- [x] 2.1 Write failing tests, then derive day windows from a series: local date per day,
      the day's actual hour count, and its daylight hours taken from the series.
- [x] 2.2 Test a polar-night fixture: zero daylight hours is a valid window and produces no
      arithmetic error anywhere downstream.
- [x] 2.3 Test a far-offset location fixture: local dates match the source's own labels and
      do not shift by a day.
- [x] 2.4 Implement the per-day completeness declaration and test that it reports what was
      actually computed.

## 3. Request validation

- [x] 3.1 Write a failing test, then validate the horizon before any outbound work; assert
      no plan is built and no call is attempted for an over-long horizon.
- [x] 3.2 Test that an omitted horizon uses the configured default and that the answer
      states the days covered.

## 4. Orchestration

- [x] 4.1 Write failing tests, then add the ranking use case wiring resolution →
      applicability → declarations → metric plan → fetch → day windows → scoring →
      ordering.
- [x] 4.2 Implement concurrent fetching that settles items individually; test that one
      failing plan item leaves the others' results intact.
- [x] 4.3 Test that every catalogue activity appears exactly once per day.
- [x] 4.4 Test that a total data failure still returns a resolved location, a time zone and
      per-activity missing-data outcomes.
- [x] 4.5 Assemble answer metadata: resolved place, obtained-at, stale flag, profile
      version, time zone; test each is present and truthful.
- [x] 4.6 Add the scope statement to the answer and test its presence.

## 5. Acceptance cases from stage 2

- [x] 5.1 Turn each acceptance case of `docs/development-flow/stage-two.md` §12 into a test
      with the same name, running against recorded fixtures.
- [x] 5.2 Cover the four distinguishable answers explicitly: inland surfing, flat-sea
      surfing, good surfing, unavailable marine source.
- [x] 5.3 Cover the seasonal case: a snow location out of season is a ranked zero, not
      inapplicable.
- [x] 5.4 Cover the inversion cases: a week of rain puts the indoor activity first; extreme
      heat with clear skies puts it above the outdoor one.
- [x] 5.5 Cover the cross-cutting constraint: a storm zeroes all four activities.
- [x] 5.6 Cover the gap case: a day above the gap threshold reports missing data while the
      other days are scored.
- [x] 5.7 Cover the selective constraint: on a day with no daylight the outdoor activities
      are ranked zeroes with that reason while the indoor one is scored on its merits and
      ranks first, with no non-numeric score anywhere in the answer.
- [x] 5.8 Mark the two deferred cases (partial current day, daylight-saving transition) as
      skipped with a reference to ТД-01.

## 6. API surface

- [x] 6.1 Add the result models and mappers so the domain outcome union is exposed without
      domain types crossing the boundary; test that renaming a domain field does not change
      the exposed shape.
- [x] 6.2 Add an end-to-end test through the API against the mock source covering one
      coastal and one inland location.

## 7. Close-out

- [x] 7.1 Verify every functional requirement of stage-two.md §9 is covered by a test,
      except those marked deferred; list the mapping in the change notes.
- [x] 7.2 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste
      the output.
- [ ] 7.3 `/code-review` at level `high`, then `/opsx:archive`.


---

## Verification (task 7.2)

```
$ npm run lint          oxlint, exit 0, no errors and no warnings
$ npx tsc --noEmit      exit 0
$ npm test              62 files, 775 passed | 2 skipped (777)
$ npm run test:e2e       5 files,  12 passed
```

The two skipped tests are the ТД-01 rows of stage-two.md §12 — the partial current day and
the daylight-saving transition — and each names the debt it waits on.

## Implementation notes

### Requirement coverage (task 7.1)

Every functional requirement of [stage-two.md §9](../../../docs/development-flow/stage-two.md),
with the test that holds it up. `⏳` is deferred with ТД-01 and carries a skipped test naming it.

| FR | Where it is tested |
|---|---|
| FR-01 | `api/graphql/ranking.args.spec.ts`; `ranking.service.spec.ts` (both a name and a point); `test/ranking.e2e-spec.ts` |
| FR-02 | `test/acceptance/applicability.spec.ts` ("Moscow"); `ranking.service.spec.ts`, "identifies the resolved place, country and region" |
| FR-03 | `test/acceptance/applicability.spec.ts`, "three spellings of one city"; `domain/shared/coordinates.spec.ts` |
| FR-04 | `domain/ranking/horizon.spec.ts`; `ranking.service.spec.ts`, "validating the request before any outbound work"; e2e, "refuses an over-long horizon" |
| FR-05 | `domain/weather/day-window.spec.ts`; `test/acceptance/ranking.spec.ts`, the Auckland and Tromso date cases; `ranking.service.spec.ts`, "carries the time zone …" |
| FR-06 ⏳ | `test/acceptance/ranking.spec.ts`, skipped: "a request at 18:00" |
| FR-07 | `geo/location-profile.service.spec.ts` (`04-add-location-applicability`) |
| FR-08 | `test/acceptance/applicability.spec.ts`; `ranking.service.spec.ts`, "makes no marine call at a place with no coastline" |
| FR-09 | `domain/ranking/activity-outcome.spec.ts`; `test/acceptance/ranking.spec.ts`, "the four distinguishable answers" |
| FR-10 | `api/graphql/ranking.mapper.spec.ts`, "resolves the human text from the code" |
| FR-11 | `test/acceptance/ranking.spec.ts` (Chamonix in summer, Tromso, the storm); `test/acceptance/ranking-outcomes.spec.ts` (a dangerous sea) |
| FR-12 | `ranking.service.spec.ts`, "names the metrics that could not be obtained"; `ranking-outcomes.spec.ts`, the gap case; `ranking.mapper.spec.ts` |
| FR-13 | `ranking.mapper.spec.ts`, "keeps a dropped feature visible"; `test/golden/golden.spec.ts`; e2e, "carries the explanation of a score" |
| FR-14 | `ranking.service.spec.ts`, "carries the time zone, the moment the data was obtained and the profile version" and the two staleness cases; e2e |
| FR-15 | `domain/ranking/rank.spec.ts`; `test/acceptance/ranking.spec.ts`, "the ordering the answer is delivered in" |
| FR-16 | `domain/ranking/rank.spec.ts`, "excludes the non-scored outcomes"; `test/acceptance/ranking.spec.ts`, "never puts a non-scored outcome among the ranked ones" |
| FR-17 | `test/acceptance/ranking.spec.ts`: the storm zeroes all four including indoor; the polar night zeroes the outdoor ones and leaves indoor first |
| FR-18 | `domain/scoring/scoring-engine.spec.ts`; `modules/activities/seed-catalogue.spec.ts` (`03-add-activity-declaration-model`) |
| FR-19 | `ranking.service.spec.ts`, "containing a failure to the activities that depend on it" |
| FR-20 | Partly. `ranking.service.spec.ts`, "reports staleness … from what the source said": the answer declares staleness truthfully from the provenance and does not fail. The other half — data *becoming* stale — has no mechanism until `07-add-source-caching-and-resilience`; see the deviation below |
| FR-21 | `test/acceptance/a-fifth-activity.spec.ts` |
| FR-22 | `ranking.service.spec.ts`, "gives the same answer twice"; `test/acceptance/ranking.spec.ts`, "answers the same way twice over unchanged recordings" |
| FR-23 | `test/setup/no-network.ts`, loaded by both vitest configs |

### Deviations and decisions taken while implementing

1. **FR-20 lands half-finished, and knowingly.** The proposal already names
   `07-add-source-caching-and-resilience` as the prerequisite for the stale-answer
   scenario: nothing before it can produce "data previously obtained". What ships here is
   the declaration — `stale` and `fetchedAt` are read from the series provenance, never
   from a constant — and a test proving that a stale series is delivered as a stale answer
   rather than as an error. The scenario "fresh data cannot be obtained but data
   previously obtained is available" cannot be reached until the cache exists.

2. **`RankingAnswer.undated` was added to the shape.** The requirement "a resolvable
   location with no usable data still answers per activity" collides with "a day is the
   location's own local date": when every source is down, no source ever told us a local
   date, and computing one from our clock is the day-shift ТД-01 forbids. The activities
   therefore answer in `undated` and `days` is empty. It is empty in every answer that
   holds data.

3. **`Provenance.timezone` was added.** A request made by coordinates carries
   `timezone: 'auto'`, and `auto` is what we asked for rather than what the answer is in.
   The source reports the zone it resolved, and the answer now carries it. The field is
   optional, so nothing that constructs a provenance had to change.

4. **`FORECAST_DAYS_MAX` was added to the environment schema.** FR-04 states a supported
   range and the schema had only a default. The schema also refuses a default above the
   ceiling, so a misconfiguration stops the start rather than failing the first request.

5. **The horizon ceiling is ours, not the source's.** `validateHorizon` in
   `weather/ports/limits.ts` already guards what a *source* accepts; this one guards what
   the *service* offers, and runs before resolution so that a refused request costs no
   geocoding call either.

6. **Two acceptance rows are written as synthetic series rather than as fixtures**
   (`test/acceptance/ranking-outcomes.spec.ts`): a dangerous sea and a day with holes.
   Neither was ever recorded — the Atlantic recordings top out at 0.86 m and every
   recorded day is complete — and a fixture is a recorded response. The declarations, the
   constraints and the engine are the shipped ones; only the weather is written by hand.

7. **The London row is asserted where the recording supports it.** Stage two says "rain
   seven days" and `london-rainy` is not that week; the discrepancy was already recorded in
   `test/acceptance/limiting-features.spec.ts`. The ordering claim is therefore checked on
   the days whose daylight hours are wet, and its converse on the dry days of the same week.

### Found here, belonging to another change

- **A throwing adapter still cancels the request during profiling.** `RankingService`
  settles its own fetches individually, so an adapter that throws costs one activity. The
  marine *probe* in `geo/location-profile.service.ts` has no such guard, and a throw there
  propagates out of `rank`. The ports' contract says a port answers rather than throws, so
  this is defence in depth rather than a live fault — it belongs with `04`'s services or
  with the resilience work of `07`.

- **The error envelope is a placeholder.** `RankingResolver` raises a `GraphQLError`
  carrying the registry code in `extensions.code`. Which codes are exposed, how they are
  shaped and what a partial failure looks like on the wire is `09-add-graphql-api`.
