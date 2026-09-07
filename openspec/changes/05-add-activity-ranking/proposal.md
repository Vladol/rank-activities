## Why

This is the scenario the service exists for: a user names a city and gets, for each of the
next few days, the four activities ordered by how well the weather suits them, with an
explanation of every number. Stage 2 (`docs/development-flow/stage-two.md`) turned it into
twenty-three functional requirements and nineteen acceptance cases, and promised them as
`openspec/specs/activity-ranking/spec.md` — which was never written, because stages 3 and 4
had to establish first what the data source can actually support and what the contracts
look like. Both are now settled.

The requirement that shapes everything else is that **an answer must be honest about which
kind of answer it is**. "Surfing in Prague" and "surfing in Lisbon on a flat day" and
"surfing in Lisbon while the wave model is down" are three different statements, and a
single number cannot carry them. Stage 2 fixed four distinguishable outcomes; without them
written as a contract, the cheapest implementation of every one of them is a zero.

The second requirement is that a partial failure stays partial. The marine source failing
must cost the user surfing, not the whole answer. That has a direct consequence for the
shape of the response, and it is the reason the result state lives on each activity rather
than on the response as a whole.

## What Changes

- **The ranking request**: a location and a horizon, with the horizon validated locally
  and rejected when it exceeds the supported range, rather than quietly shortened.
- **A day is the location's own local date**, and the time zone travels with the answer,
  so a day near a date boundary is never ambiguous.
- **Three honest outcomes per activity per day** — ranked, inapplicable, or missing data —
  with a zero score kept as a legitimate ranked result that names the constraint it
  violated. Four distinguishable answers in total.
- **Ordering that is defined, not incidental**: descending by score, ties broken
  deterministically, and non-scored outcomes excluded from the ordering and grouped
  separately, because they are not worse than zero, they are a different kind of statement.
- **Response metadata that makes an answer accountable**: which place was resolved, when
  the data was obtained, whether it is stale, which scoring profile version was used, and
  the location's time zone.
- **Partial failure is contained per activity**, so one unavailable source removes one
  activity and not the answer.
- **A stated scope**, returned with the answer: this service ranks weather and knows
  nothing about avalanche risk, lift operations, tides or opening hours.

**Out of scope, deliberately:**

- The transport contract — GraphQL type names, error envelope, complexity limits,
  throttling. This spec states what an answer must contain and mean; how it is carried and
  protected is `graphql-api`.
- Caching, staleness mechanics and retries. This spec requires that staleness be
  *declared*; how data becomes stale is `07-add-source-caching-and-resilience`. That change
  is a prerequisite for the stale-answer requirement below: nothing before it can produce
  "data previously obtained".
- Multi-location requests, hourly ranking and personal profiles.
- The partial current day (deferred as ТД-01 in stage-two.md §10). The response declares
  per day whether it was computed from a complete day; today that declaration is honest and
  always states "complete".

## Capabilities

### New Capabilities

- `activity-ranking`: the end-to-end scenario from a location and a horizon to an ordered,
  explained, accountable answer per day — request validation, day identity, the four
  distinguishable outcomes, ordering, response metadata, partial failure and determinism.

### Modified Capabilities

None.

## Impact

| Area | Effect |
|---|---|
| `src/domain/ranking/` | Outcome union, ordering and tie-breaking |
| `src/domain/weather/day-window.ts` | Day and daylight windows derived from the series |
| `src/modules/ranking/` | The use case orchestrating resolution, planning, fetching and scoring |
| `src/modules/api/graphql/` | Result models and mappers (shape only; transport rules are a later change) |
| `openspec/changes/01-add-weather-source-contract` | Prerequisite |
| `openspec/changes/03-add-activity-declaration-model` | Prerequisite |
| `openspec/changes/04-add-location-applicability` | Prerequisite |
| Dependencies | None added |
