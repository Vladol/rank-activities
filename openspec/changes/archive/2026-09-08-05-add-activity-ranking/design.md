## Context

This change assembles what the other three stage 4 changes provide: capability ports and
canonical series (`01-add-weather-source-contract`), declarations and the scoring engine
(`03-add-activity-declaration-model`), and resolved locations with applicability
(`04-add-location-applicability`). It lands last of the four.

Two constraints from earlier stages shape it. Stage 2 deferred all local-time arithmetic
(ТД-01): the source is asked for local time and its dates are used as opaque labels, so
nothing here computes a time zone offset. Stage 3 measured the cost of the scenario: one
outbound call for an inland location, two for a coastal one, ~136 ms each, issued
concurrently.

## Goals / Non-Goals

**Goals:**

- Four distinguishable answers, none of which can be produced by accident.
- A partial failure that stays partial.
- An answer that can be argued with: which place, when, under which rules.

**Non-Goals:**

- The transport contract (GraphQL types, error envelope, limits) — `graphql-api`.
- Caching and staleness mechanics — `07-add-source-caching-and-resilience`. This spec only requires that
  staleness be declared when it occurs.
- Multi-location requests, hourly ranking, personal profiles.
- The partial current day. The per-day completeness declaration exists and is honest now;
  the behaviour it will describe arrives with ТД-01.

## Decisions

### Decision 1: The outcome union lives on the activity, not on the response

Each activity for each day carries its own outcome.

**Alternative rejected: one outcome for the whole response.** Much simpler to produce and
to consume, and it makes the marine source's failure cancel skiing and sightseeing too —
which contradicts the requirement that a partial failure stay partial.

**Alternative rejected: a score plus optional reason fields on one result type.** The
smallest change to a conventional shape, and it lets a consumer read the score and ignore
the reason. The state that "must not be misread as a number" would be exactly the one a
careless client misreads.

### Decision 2: A ranked zero is a first-class answer

Zero means "possible here, not today", carries the violated constraint, and is ordered
among the ranked results.

**Alternative rejected: mapping a violated constraint to inapplicable.** One state fewer
to explain. It also tells a user in Chamonix in July that skiing does not exist there,
which is false, and it destroys the distinction stage 2 built the contract around.

### Decision 3: Non-scored outcomes are excluded from ordering

Inapplicable and missing-data results are grouped after the ranked ones and are not sorted
by score.

**Alternative rejected: sorting them as zero.** It produces one flat list, and it places
"there is no sea here" next to "the sea is flat today" as though they were comparable
degrees of the same thing.

### Decision 4: Ties are broken by the activity's stable code

**Alternative rejected: leaving tie order unspecified.** Nothing to implement, and it makes
the determinism requirement untestable: a regression suite could not assert an ordering.

### Decision 5: The horizon is validated locally, before any call

**Alternative rejected: letting the source reject it and mapping its error.** No local
range to maintain. Stage 3 recorded the source answering an over-long horizon with a
factually wrong message, so the mapped error would be built on text known to be unreliable
— and a rejected request would still have cost a round trip.

### Decision 6: Per-day completeness is declared now, though always complete

The response says, per day, whether it was computed from a complete local day.

**Alternative rejected: omitting the field until ТД-01 is paid.** Less to carry now, and
adding it later changes the shape of every day in the answer. Declaring it now costs one
honest boolean.

### Decision 7: Sources are fetched concurrently, and settled individually

The plan's items are issued together and their outcomes are collected individually.

**Alternative rejected: failing the batch when any item fails.** The default behaviour of
the obvious concurrency primitive, and it silently converts a partial failure into a total
one — the requirement most likely to be broken by writing idiomatic code without thinking.

## Risks / Trade-offs

- **The answer's field set overlaps with what `graphql-api` will specify.** Mitigation:
  this spec names contents and meanings, never type names or wire encoding; the transport
  change refers to it rather than restating it.
- **Four outcomes multiply the client's work.** Accepted: it is the point. The cost is
  bounded because the reason codes come from one registry.
- **This change depends on three others, so it can only be verified late.** Mitigation: the
  acceptance cases run against recorded fixtures, so they can be written before the live
  adapter exists and become the regression suite afterwards.
- **Determinism depends on the underlying data being unchanged**, which caching influences.
  Mitigation: the requirement is stated against unchanged data, and the acceptance suite
  runs on fixtures.

## Open Questions

- Whether the scope statement is one text for the service or one per activity. Per-activity
  text is more useful for skiing than for museums, and it can be added as a declaration
  field without changing a requirement here.
- Whether an answer should expose the number of days actually returned separately from the
  requested horizon once partial days exist. Not needed while every returned day is
  complete.
