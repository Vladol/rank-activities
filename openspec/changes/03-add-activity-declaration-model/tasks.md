## 1. Registries the declaration refers to

- [x] 1.1 Write failing tests for `linear`, `inverse`, `trapezoid`, `gaussian`,
      `inverseGaussian` and `step` as pure functions returning 0…1, then add them under
      `src/domain/scoring/normalizers/`. Clamping is unconditional — there is no `clamp`
      parameter.
- [x] 1.2 Add `normalizer.registry.ts` where each entry carries a parameter schema and its
      declared monotonicity; test that registering a duplicate code fails, that parameters
      are validated by the entry's own schema, and that the six invariants of stage 5 §2
      hold under property-based tests.
- [x] 1.3 Write failing tests, then add the aggregation registry with `mean`, `max`, `min`,
      `sum`, `identity`, `shareOfHours`, `countIf` and `daylightWindow`; test that each
      reports how many slots contributed and how many were missing, and that an entry
      declares which granularity it reads from.
- [x] 1.4 Test `daylightWindow` against a day with zero daylight hours: it returns no
      value, never a non-numeric one.
- [x] 1.5 Test `shareOfHours` against a day whose series holds 23 hours: the denominator is
      23, not 24.
- [x] 1.6 Add the shared predicate tree (`lt`/`lte`/`gt`/`gte`/`eq`/`ne`/`in`/`notIn` with
      `anyOf`/`allOf`/`not`) used by both `shareOfHours` and hard constraints; test that
      `in` over WMO codes never compares codes by magnitude.
- [x] 1.7 Add the derived-metric registry with the three entries of stage 5 §4: the angle
      between wind and wave direction, cold fresh snowfall, and the freezing-level margin
      against the series elevation. Test that each declares its base metrics, is not named
      after an activity, and reads no location record.
- [x] 1.8 Pin the direction convention with an acceptance test on a west-coast fixture: an
      easterly wind must yield a high wind–wave angle. Inverting the convention must fail
      the test (stage 5 §16.1).

## 2. Declaration format and validation

- [x] 2.1 Write a failing test loading a declaration that references an unknown metric,
      then add the declaration types and the load-time schema in `src/domain/activity/`.
- [x] 2.2 Test: normaliser parameters that do not satisfy the normaliser's schema fail the
      load, naming the feature.
- [x] 2.3 Test: one invalid declaration prevents startup even when the others are valid.
- [x] 2.4 Implement weight normalisation on load over contributing features only; test
      rescaling of weights summing to 2.0, rejection of weights summing to 0, and that
      adding a limiting feature does not rescale the others.
- [x] 2.5 Implement shared-rule includes; test that the severe-weather constraint reaches
      all four activities including indoor, that the no-daylight constraint reaches the
      three outdoor activities and not indoor, and that an unknown include fails the load.
- [x] 2.6 Test that a published version cannot be redefined with different content.
- [x] 2.7 Implement the unit restatement check; test that a feature declaring `km/h` for a
      metric carried in `m/s` fails the load, naming both units.
- [x] 2.8 Add `plausible` ranges to the metric dictionary and check every declared
      threshold and curve parameter against them; test that a gust threshold of `60`
      declared in `m/s` fails the load.

## 3. Scoring engine stages

- [x] 3.1 Write failing tests, then add feature extraction: declaration + series + day
      window → aggregated values with sample and missing counts.
- [x] 3.2 Add null-policy handling; test `degrade`, `exclude` with weight redistribution,
      and `fail` producing missing data naming the metric.
- [x] 3.3 Test the excess-gaps rule: a partially-covered required metric above the
      threshold makes that one day missing data while the other six are scored, and a
      metric absent for the whole day is left to the null policy instead (the ERA5
      `visibility` fixture must still score).
- [x] 3.4 Add constraint evaluation; test that a fired constraint yields zero with its
      reason, that the first declared constraint wins when two fire, that a constraint does
      not fire on an absent value, and that a fired constraint outranks a missing
      `fail`-policy feature.
- [x] 3.5 Add normalisation, weighting and combination, including limiting features as
      factors with their declared lower limit; test that the emitted contributions and
      factors reproduce the score before bounds, and that a limiting feature at its maximum
      changes nothing.
- [x] 3.6 Add bounds; test the floor, the ceiling, and that a constraint-driven zero
      ignores the floor.
- [x] 3.7 Add the scoring profile with identity and version; test that the same declaration
      under two profiles yields two results each naming its profile.
- [x] 3.8 Test determinism: two evaluations of the same inputs are identical, explanation
      ordering included.
- [x] 3.9 Reproduce the two reference cases that motivated limiting features: "Dubai, +45 °C
      and clear" and "London, rain all week" must both rank indoor above outdoor with one
      set of weights.

## 4. Catalogue and seeds

- [x] 4.1 Add the catalogue port and an in-memory registry loading the seed declarations at
      startup; test that the set of rankable activities equals the set of active
      declarations.
- [x] 4.2 Write `shared-rules.json` with the severe-weather and no-daylight constraints of
      stage 5 §5.6.
- [x] 4.3 Write the four seed declarations verbatim from stage 5 §6, and the `default@1`
      scoring profile carrying the gap threshold and the neutral value.
- [x] 4.4 Verify the indoor declaration expresses its inversion, floor and ceiling with no
      indoor-specific code anywhere.
- [x] 4.5 Add a fifth throwaway declaration, confirm it is ranked with zero code changes,
      then delete it and record the result in the change notes.
- [x] 4.6 Record the golden snapshot of scores across all fixtures; from here on a weight
      change is reviewed by its delta.

## 5. Close-out

- [x] 5.1 Assert by test or lint rule that no file under `src/domain/scoring/` or
      `src/modules/` is named after an activity.
- [x] 5.2 Run `npm run lint`, `npm test`, `npx tsc --noEmit` and paste the output.
- [x] 5.3 `/code-review` at level `high` — four faults found and fixed, see the notes
      below. `/opsx:archive` is not run yet.

## Notes from the implementation

**Task 4.5, the fifth activity.** Kept as a test rather than added and deleted:
`test/acceptance/a-fifth-activity.spec.ts` writes `kitesurfing.activity.json` into a
copy of the seed directory, loads the catalogue from it and scores it on the Lisbon
recording. It ranks, its wind curve is the inversion of every other activity's, and the
four existing activities score identically with it present. Nothing under `src/` was
touched to make that happen — which is the claim, and it now stays checked instead of
being checked once.

**Deviations from stage 5, both to avoid a second vocabulary.** Declarations name metrics
by the dictionary's own codes (`snow_depth`, not `SNOW_DEPTH`) and units by the canonical
ones (`degC`, `second`, `degree`, not `C`, `s`, `deg`). The document's shorthand would
need a translation table, and the translation table is the thing that gets forgotten.
`role: "gate"` and `gateFloor` are kept as the document wrote them; the specs' phrase for
the same thing is "limiting feature".

**Two additions to the registries of stage 4.** `MISSING_REQUIRED_METRIC` joins the reason
registry: the `fail` policy owes a reason naming the metric, and `TOO_MANY_GAPS` is a
different statement. `ratio` joins the canonical units as what `shareOfHours` answers in;
no metric is carried in it.

**The direction convention (stage 5 §4).** The formula printed there, `180 - angle`,
contradicts both its own labels and its own acceptance criterion. The labels and the
criterion agree with each other, so the angle itself is what ships, pinned by
`test/acceptance/wind-wave-alignment.spec.ts` against the Lisbon recording.

**Findings for a later change, none of them acted on here** (re-calibration is out of
scope by the proposal):

- The `london-rainy` recording is not a rainy week. Two of its seven days hold no
  precipitation at all and on a third the rain fell overnight, leaving 7 of 13 daylight
  hours wet. The reference case of stage 2 §12 ("indoor first every day") cannot be
  asserted against it without asserting that a dry 20 °C day in London is a day for a
  museum. The acceptance test checks the requirement on the day whose daylight hours are
  wet, and checks the converse on the dry days. A recording over a genuinely wet week
  would let the row be stated as written.
- `wind_gusts_10m` carries `plausible: [0, 45]` from stage 5 §8, and the `storm-gusts`
  recording holds 54.8 m/s. The range is only ever applied to declared thresholds, so
  nothing is wrong today, but the bound is not physical as described.
- `precipitation_hours` counts any hour with precipitation, while outdoor's `dryHours`
  counts an hour under 0.1 mm as dry. On a drizzle day the two features read the same
  weather oppositely. Both readings are deliberate — indoor reads the whole day, outdoor
  the daylight window — but the pair is worth a look when the weights are next revisited.
