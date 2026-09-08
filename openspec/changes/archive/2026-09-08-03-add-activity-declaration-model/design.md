## Context

`src/domain/` is empty. `01-add-weather-source-contract` creates the metric dictionary,
canonical units and the series type this change reads; it must land first. Storage arrives
in stage 6, so the catalogue is loaded from seed files behind a port until then.

Stage 5 will calibrate the numbers. This change therefore has to make the declaration
expressive enough for stage 5 to have nothing left to add in TypeScript — the reason the
model is fixed before the values are known.

## Goals / Non-Goals

**Goals:**

- A declaration expressive enough for all four activities of stage 2, including the two
  cases that break naive models: indoor sightseeing as a bounded inversion, and
  cross-cutting constraints that must reach every activity.
- Invalid declarations fail at startup, never at request time.
- Explanation and score produced by one pass.

**Non-Goals:**

- Thresholds and weights (stage 5), personal profiles, and persistence in PostgreSQL.
- Sorting, response shape and result states, which belong to `activity-ranking`.
- Hourly ranking. The aggregation strategy is the seam that will allow it; no
  requirement here assumes a day is the only possible window.

## Decisions

### Decision 1: A declaration is data validated against registries, not a typed module

Declarations are JSON, validated on load against the metric dictionary and the normaliser,
aggregation and applicability registries. The validation schema is assembled from those
registries, so a normaliser's parameter schema validates the parameters given to it.

**Alternative rejected: declarations as TypeScript objects.** The compiler would check
them for free, with no load-time validation to write. It also makes "add an activity" a
code change and a release, which is the one thing this project has committed to avoiding,
and it puts rules out of reach of anything but a deploy.

**Alternative rejected: JSON with a hand-written schema.** Simpler to read, and it drifts:
the schema would list normaliser names separately from the registry, so a new curve would
have to be added twice, and the second place would eventually be forgotten.

### Decision 2: Shared rules are included by reference

Constraints that apply to everything are declared once and referenced by an include list.

**Alternative rejected: implicit application of all shared rules to all activities.**
Fewer characters in each declaration, and it removes the ability to say that a rule does
not apply — an indoor activity that should not be zeroed by darkness could not opt out
without a code exception.

**Alternative rejected: copying the constraint into each declaration.** Explicit and
self-contained per file, and stage 2 identified exactly this as the failure mode: the
fifth activity is added and the rule is forgotten.

### Decision 3: Constraints are evaluated before weighting and short-circuit

A fired constraint produces a zero carrying its reason, without evaluating the weighted
combination.

**Alternative rejected: expressing constraints as features with a zero-valued curve.**
Elegant — one mechanism instead of two — and it loses the reason code: the result would
say zero without saying why, which is the distinction stage 2 built the contract around.

### Decision 4: The null policy lives on the feature, not on the activity

Each feature declares degrade, exclude or fail.

**Alternative rejected: one policy per activity.** Simpler to reason about globally, and
wrong for the observed data: ski needs snow depth (fail) and can live without visibility
(exclude), because ERA5 returns visibility null in all 168 slots of an archive response.

### Decision 5: Explanation is a by-product of scoring

The normalisation and weighting pass emits the contributions it already computes.

**Alternative rejected: a separate explain pass reading the same inputs.** Keeps the
scoring function small, and creates two code paths that can disagree — and the one that
disagrees is the one shown to the user.

### Decision 6: Bounds after combination, constraints above bounds

Floor and ceiling are applied to the combined score; a constraint-driven zero ignores the
floor.

**Alternative rejected: clamping each feature's contribution.** Keeps bounds close to the
data, and makes the promise "indoor never drops below the floor" unverifiable, because the
floor would depend on how many features contributed that day.

### Decision 7: Derived metrics are registry entries, not activity code

A value no source returns directly is declared as a derived metric with its base metrics.

**Alternative rejected: computing it inside the activity that needs it.** The shortest
path, and it is precisely how the first activity-specific service class gets written; the
next activity needing the same value then copies it.

### Decision 8: Some features limit the score instead of contributing to it

A feature may be declared as limiting: it does not carry a weight, and its normalised value
becomes a factor on the weighted sum of the contributing features, bounded below by a limit
the feature declares.

**Alternative rejected: a weighted sum alone.** One mechanism instead of two, and it cannot
express the requirements. Stage 5 showed the contradiction arithmetically
(`docs/development-flow/stage-five.md` §5.5): "Dubai, +45 °C and clear" forces the thermal
comfort weight above 0.59 for indoor to win, "London, rain all week" forces it below 0.35
for indoor to win there — an empty interval. A weighted sum is compensatory by
construction, and heat of +45 °C admits no compensation.

**Alternative rejected: a hard constraint on temperature.** Expressive enough for Dubai and
already available, and it would report "outdoor sightseeing is impossible today" at +34 °C,
which is false. A refusal must be able to name a reason; a gradual penalty must not pretend
to be one.

**Alternative rejected: a weighted geometric mean for every feature.** Non-compensatory
everywhere, in one formula, with no new field. It also makes every single feature capable
of collapsing the whole score, so a missing-visibility day would read as a ruined day, and
the weights would lose their intuitive meaning.

### Decision 9: A declaration restates the unit it expects, and thresholds are range-checked

Each feature and threshold names the unit it is written in, which the loader compares with
the metric's canonical unit, and every numeric parameter is checked against a plausible
range declared for the metric.

**Alternative rejected: relying on the metric dictionary alone.** The dictionary already
knows that wind is carried in m/s, so the restatement is redundant — deliberately. The
failure it guards against is a threshold of `60` written by someone thinking in km/h, and
the dictionary cannot see that: the value is a well-typed number in the right field.
Neither half of the check works alone, because 60 m/s is a physically possible hurricane
and a plausible range cannot reject it; the declared unit makes the author's intent
explicit, and the range then rejects what is only meaningful in another unit.

## Risks / Trade-offs

- **The declaration format was fixed before the numbers existed, and stage 5 did find it
  short.** Filling the declarations with real values produced two additions — limiting
  features (Decision 8) and the unit restatement (Decision 9) — and one reordering of the
  engine stages. This is the mitigation working as intended: the gap surfaced in this
  change rather than after implementation.
- **Load-time validation makes a bad declaration a startup failure.** Accepted
  deliberately: the alternative is a runtime `NaN` reaching a user. Mitigated by naming
  the declaration, the feature and the fault in the message.
- **Registries make behaviour indirect: reading a declaration requires knowing what
  `trapezoid` means.** Mitigation: each registry entry is a small pure function with its
  own tests, and the curve is named for its shape rather than for an activity.
- **A profile identifier in every result implies profile plumbing before profiles are
  useful.** Accepted: adding it later would change the result contract, and stage 8 lists
  A/B of scoring as a planned direction.

## Open Questions

- Whether the excess-gaps threshold belongs to the profile or to each activity. Stage 5
  placed it on the profile alongside the neutral value used by the degrade policy; making
  it per-activity later adds a declaration field without changing any requirement.
- Whether an activity should be able to declare a metric as optional at the metric-planning
  level (do not fetch if expensive) as distinct from the feature null policy. Not needed
  by the four current activities.
- Whether a second limiting feature is warranted. Visibility for outdoor sightseeing is
  non-compensatory by the same argument as heat — fog ruins a viewpoint whatever else is
  true — but no reference case forces it yet
  (`docs/development-flow/stage-five.md` §16.4).
