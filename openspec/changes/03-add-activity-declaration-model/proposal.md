## Why

The premise of the whole service is that **an activity is data, not code**: adding
kitesurfing, or moving the ideal ski temperature by two degrees, must not require a
release. That premise is currently a sentence in `CLAUDE.md` with nothing enforcing it.
The first activity implemented as a service class makes it false, and nothing in the
build would notice.

Stage 2 also produced a requirement that only a declarative model can satisfy honestly:
a rule such as `SEVERE_WEATHER` is "declared once and reused, otherwise the fifth activity
will forget it" (`docs/development-flow/stage-two.md` §6). Copying a rule into four files
is how it gets forgotten. The same mechanism has to support the opposite case: stage 5
established that `NO_DAYLIGHT` must reach the outdoor activities and must not reach indoor
sightseeing, or the "Tromsø in December" reference case cannot pass. Composition by
reference gives both without an exception in code.

Stage 4 (`docs/development-flow/stage-four.md` §4.4–4.8) worked out what the declaration
has to express before the numbers exist: aggregation over a day or over its daylight
hours, a normalisation curve with parameters, a weight, a null policy per feature, hard
constraints that short-circuit the score, and a floor and ceiling for indoor. Stage 5
(`docs/development-flow/stage-five.md`) then filled that model with values and, in doing
so, found the two places where it was short. This change ships the corrected model, the
engine that reads it, and the calibrated declarations — after which moving a threshold
touches no TypeScript at all.

## What Changes

- **An activity declaration format**, validated at load time against the registries it
  refers to: an unknown metric, an unknown normaliser or normaliser parameters that do
  not match its schema stop the service at startup instead of producing `NaN` at runtime.
- **Composable shared rules.** Constraints that apply to every activity are declared once
  and included by reference.
- **Weights are normalised to sum to 1 on load**, so editing one weight does not shift the
  scale of the whole result.
- **Append-only versioning of declarations.** A published version is immutable; a change
  is a new version, and the version used is reported with the result, so a past
  computation stays reproducible.
- **A scoring engine driven entirely by the declaration**: aggregate everything the
  declaration refers to, reject a day too incomplete to judge, evaluate constraints, apply
  the null policies, normalise and combine, then apply bounds. What is known decides before
  what is absent. Explanation is produced by the same pass that produces the number, not by
  a second one.
- **Two ways for a feature to enter the score**: a weighted contribution, or a limiting
  factor for a dimension that admits no compensation. A weighted sum alone cannot satisfy
  the "Dubai heat" and "London rain" reference cases at once — see `design.md`, Decision 8.
- **A declaration restates the unit it expects and its thresholds are range-checked**, so a
  threshold written in the source's unit rather than the canonical one stops the start
  instead of scoring silently wrong by a factor of 3.6.
- **Extension by registry**, not by editing the engine: a new curve shape is a new
  normaliser, a new way to collapse a series is a new aggregation, and a value no source
  provides directly is a derived metric.
- **A null policy per feature** — degrade, exclude or fail — because a metric that is null
  for a whole series is normal (ERA5 returns `visibility` null in all 168 slots).
- **The four calibrated declarations** from stage 5 §6, each threshold traceable to a
  physical anchor, an agreed requirement, an observed range or a reference case.

**Out of scope, deliberately:**

- **Re-calibration.** The values shipped here are the ones stage 5 derived. Moving a
  threshold or a weight afterwards is a change of its own, with its own reasoning and its
  own golden-snapshot delta.
- Persistence of declarations in PostgreSQL. Storage is `08-add-data-persistence`; until
  then the catalogue is loaded from the seed files, behind a port so the store can change.
  The file-backed implementation stays afterwards — it is what keeps FR-23 true.
- Personal scoring profiles. The profile identifier and version are part of the contract
  from the start; user-specific weights are a later change.
- Ranking, sorting and the response contract, which belong to `activity-ranking`.

## Capabilities

### New Capabilities

- `activity-catalog`: activities expressed as versioned declarations — the format,
  validation at load, shared-rule composition, weight normalisation, immutability of a
  published version, and the guarantee that a new activity costs no code.
- `scoring-engine`: turning a declaration and a weather series into a score for one
  activity on one day — constraint precedence, aggregation, normalisation, weighting,
  null policy, bounds, determinism, and the per-feature explanation.

### Modified Capabilities

None.

## Impact

| Area | Effect |
|---|---|
| `src/domain/activity/` | Declaration types, validation schema, shared rules, applicability rule references |
| `src/domain/scoring/` | Normaliser and aggregation registries, constraint evaluation, engine stages, breakdown, scoring profile |
| `src/domain/weather/derived/` | Derived-metric registry (values no source returns directly) |
| `src/modules/activities/` | Catalogue port, in-memory registry, seed declarations |
| `src/modules/scoring/` | Profile loading and the `default@1` profile seed |
| `test/golden/` | Reference scores per fixture; its delta is how a weight change is reviewed |
| `openspec/changes/01-add-weather-source-contract` | Prerequisite: metric dictionary and series types |
| Dependencies | None added |
