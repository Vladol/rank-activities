## 1. Registries the declaration refers to

- [ ] 1.1 Write failing tests for `linear`, `inverse`, `trapezoid`, `gaussian`,
      `inverseGaussian` and `step` as pure functions returning 0…1, then add them under
      `src/domain/scoring/normalizers/`. Clamping is unconditional — there is no `clamp`
      parameter.
- [ ] 1.2 Add `normalizer.registry.ts` where each entry carries a parameter schema and its
      declared monotonicity; test that registering a duplicate code fails, that parameters
      are validated by the entry's own schema, and that the six invariants of stage 5 §2
      hold under property-based tests.
- [ ] 1.3 Write failing tests, then add the aggregation registry with `mean`, `max`, `min`,
      `sum`, `identity`, `shareOfHours`, `countIf` and `daylightWindow`; test that each
      reports how many slots contributed and how many were missing, and that an entry
      declares which granularity it reads from.
- [ ] 1.4 Test `daylightWindow` against a day with zero daylight hours: it returns no
      value, never a non-numeric one.
- [ ] 1.5 Test `shareOfHours` against a day whose series holds 23 hours: the denominator is
      23, not 24.
- [ ] 1.6 Add the shared predicate tree (`lt`/`lte`/`gt`/`gte`/`eq`/`ne`/`in`/`notIn` with
      `anyOf`/`allOf`/`not`) used by both `shareOfHours` and hard constraints; test that
      `in` over WMO codes never compares codes by magnitude.
- [ ] 1.7 Add the derived-metric registry with the three entries of stage 5 §4: the angle
      between wind and wave direction, cold fresh snowfall, and the freezing-level margin
      against the series elevation. Test that each declares its base metrics, is not named
      after an activity, and reads no location record.
- [ ] 1.8 Pin the direction convention with an acceptance test on a west-coast fixture: an
      easterly wind must yield a high wind–wave angle. Inverting the convention must fail
      the test (stage 5 §16.1).

## 2. Declaration format and validation

- [ ] 2.1 Write a failing test loading a declaration that references an unknown metric,
      then add the declaration types and the load-time schema in `src/domain/activity/`.
- [ ] 2.2 Test: normaliser parameters that do not satisfy the normaliser's schema fail the
      load, naming the feature.
- [ ] 2.3 Test: one invalid declaration prevents startup even when the others are valid.
- [ ] 2.4 Implement weight normalisation on load over contributing features only; test
      rescaling of weights summing to 2.0, rejection of weights summing to 0, and that
      adding a limiting feature does not rescale the others.
- [ ] 2.5 Implement shared-rule includes; test that the severe-weather constraint reaches
      all four activities including indoor, that the no-daylight constraint reaches the
      three outdoor activities and not indoor, and that an unknown include fails the load.
- [ ] 2.6 Test that a published version cannot be redefined with different content.
- [ ] 2.7 Implement the unit restatement check; test that a feature declaring `km/h` for a
      metric carried in `m/s` fails the load, naming both units.
- [ ] 2.8 Add `plausible` ranges to the metric dictionary and check every declared
      threshold and curve parameter against them; test that a gust threshold of `60`
      declared in `m/s` fails the load.

## 3. Scoring engine stages

- [ ] 3.1 Write failing tests, then add feature extraction: declaration + series + day
      window → aggregated values with sample and missing counts.
- [ ] 3.2 Add null-policy handling; test `degrade`, `exclude` with weight redistribution,
      and `fail` producing missing data naming the metric.
- [ ] 3.3 Test the excess-gaps rule: a partially-covered required metric above the
      threshold makes that one day missing data while the other six are scored, and a
      metric absent for the whole day is left to the null policy instead (the ERA5
      `visibility` fixture must still score).
- [ ] 3.4 Add constraint evaluation; test that a fired constraint yields zero with its
      reason, that the first declared constraint wins when two fire, that a constraint does
      not fire on an absent value, and that a fired constraint outranks a missing
      `fail`-policy feature.
- [ ] 3.5 Add normalisation, weighting and combination, including limiting features as
      factors with their declared lower limit; test that the emitted contributions and
      factors reproduce the score before bounds, and that a limiting feature at its maximum
      changes nothing.
- [ ] 3.6 Add bounds; test the floor, the ceiling, and that a constraint-driven zero
      ignores the floor.
- [ ] 3.7 Add the scoring profile with identity and version; test that the same declaration
      under two profiles yields two results each naming its profile.
- [ ] 3.8 Test determinism: two evaluations of the same inputs are identical, explanation
      ordering included.
- [ ] 3.9 Reproduce the two reference cases that motivated limiting features: "Dubai, +45 °C
      and clear" and "London, rain all week" must both rank indoor above outdoor with one
      set of weights.

## 4. Catalogue and seeds

- [ ] 4.1 Add the catalogue port and an in-memory registry loading the seed declarations at
      startup; test that the set of rankable activities equals the set of active
      declarations.
- [ ] 4.2 Write `shared-rules.json` with the severe-weather and no-daylight constraints of
      stage 5 §5.6.
- [ ] 4.3 Write the four seed declarations verbatim from stage 5 §6, and the `default@1`
      scoring profile carrying the gap threshold and the neutral value.
- [ ] 4.4 Verify the indoor declaration expresses its inversion, floor and ceiling with no
      indoor-specific code anywhere.
- [ ] 4.5 Add a fifth throwaway declaration, confirm it is ranked with zero code changes,
      then delete it and record the result in the change notes.
- [ ] 4.6 Record the golden snapshot of scores across all fixtures; from here on a weight
      change is reviewed by its delta.

## 5. Close-out

- [ ] 5.1 Assert by test or lint rule that no file under `src/domain/scoring/` or
      `src/modules/` is named after an activity.
- [ ] 5.2 Run `npm run lint`, `npm test`, `npx tsc --noEmit` and paste the output.
- [ ] 5.3 `/code-review` at level `high`, then `/opsx:archive`.
