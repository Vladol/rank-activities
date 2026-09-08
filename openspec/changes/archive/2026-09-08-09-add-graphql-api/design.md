## Context

`05-add-activity-ranking` deliberately stopped at the meaning of an answer and left its carriage
to a change that did not exist. This is that change, and it is the last one before the service
has a surface a user can reach.

Most of what follows was decided in stage 4 §7 and stage 6 §2.5 and needs restating as behaviour
rather than re-arguing. Two constraints from elsewhere shape it: the generated SDL is not
editable — a hook blocks it and the file is gitignored — so the contract exists only as
TypeScript types and resolvers; and the reason registry from `activity-ranking` is the single
source of every code the API can emit, in an error or in a state.

Order: after `05` (there is nothing to carry before it) and after `08` (readiness is defined in
terms of the store and its schema).

## Goals / Non-Goals

**Goals:**

- A client that handles the schema correctly cannot receive a dishonest answer: no zero standing
  in for a refusal, no null standing in for a state.
- The distinction between "your request was wrong" and "the answer about this activity is that it
  is impossible here" is visible in the transport, not only in prose.
- Nothing about the vendor, the internals or the stack leaves the process.

**Non-Goals:**

- Observability beyond the trace identifier that an answer must carry.
- Query-cost analysis. The schema has no fan-out to analyse yet.
- Any authentication model.

## Decisions

### Decision 1: A union at the activity level, not nullable fields on one type

Each activity's result is one of three types in a union, nested inside a day, inside the answer.

**Alternative rejected: one result type with nullable `score`, `reason` and `missing` fields.**
It is a smaller schema and every client compiles against it immediately. It also makes the three
outcomes indistinguishable to the type system — `score: null` is exactly the "zero instead of an
honest refusal" the domain forbids — and it makes the partial-failure requirement a matter of
resolver discipline rather than of contract.

**Alternative rejected: the union at the level of the whole answer.** It would model "the ranking
failed" cleanly and would make a marine outage cost the entire answer, which `activity-ranking`
forbids explicitly.

### Decision 2: Request failures are transport errors; outcomes are data

An unresolvable location, an out-of-range horizon and invalid coordinates are GraphQL errors
carrying a registry code and a trace identifier. Inapplicable, missing data and a ranked zero are
values in a successful response.

**Alternative rejected: returning every failure as a payload variant** (the "errors as data"
style). It is fashionable, avoids the error array entirely and is genuinely better for form
validation. Here it would flatten the one distinction the service exists to preserve: a request
that could not be understood is not an answer about the world, and giving both the same shape
invites clients to treat them the same way.

**Alternative rejected: HTTP status codes carrying meaning.** GraphQL answers `200` for
everything a resolver produced; encoding domain meaning in the status would work only for the
subset of failures that happen before the resolver.

### Decision 3: API models are separate from domain types

Resolvers return view models assembled by mappers.

**Alternative rejected: decorating the domain types and returning them directly.** It removes a
mapper per type and a layer of files. It also makes every rename inside the domain a breaking
change to a public contract, and it puts GraphQL decorators inside `src/domain/`, which the
linter forbids for a reason.

### Decision 4: The domain's bounds are in the contract, not only in a validator

The horizon's range is part of the input's definition; exceeding it is rejected before any work.

**Alternative rejected: accepting any horizon and clamping it to the maximum.** Friendlier, and
it answers a question the user did not ask while claiming to have answered the one they did.
`activity-ranking` requires rejection rather than truncation.

### Decision 5: A depth limit now, a cost analyser later

**Alternative rejected: `graphql-query-complexity` as the first measure.** It is the standard
answer, and stage 6 measured that the standard answer defends this schema against a threat it
does not have: `rankActivities → days → activities → breakdown` is shallow, non-recursive and
has no fan-out multiplier. The real amplification is a stream of distinct city names, which no
cost analyser sees and an inbound limit does. The analyser returns with multi-location.

### Decision 6: Apollo operation batching is disabled

**Alternative rejected: leaving it on, which is more convenient for clients.** A batch is one HTTP
request carrying many operations, so it passes the inbound limiter once for arbitrarily much work,
and it breaks the one-request-one-trace-identifier correspondence that ADR 0004 depends on.

### Decision 7: Readiness covers the store, never the weather source

Liveness is the process. Readiness is the process plus a reachable store at the expected schema.

**Alternative rejected: including source availability in readiness.** It looks like honesty about
the service's ability to do its job. Under an orchestrator it means a source outage removes every
instance from rotation — so a service that could still answer from cached data and mark it stale
answers nothing at all. The source's state is a metric and an alert.

## Risks / Trade-offs

- **`@nestjs/throttler` does not declare compatibility with Nest 12** (peer range ends at 11).
  Recorded as stage 6 §9.1: installed under the `--legacy-peer-deps` the project already requires,
  and verified by running the e2e suite with it enabled. If it does not work, the fallback is a
  small limiter over the same token bucket the outbound budget already uses.
- **A union is more work for every client than a flat type.** Accepted, and it is the point: the
  work is handling the states, and the alternative is not less work but unhandled states.
- **Turning introspection off in production makes the API harder to explore.** Mitigated by the
  schema being generated on every start and documented in the repository.
- **Additive-only evolution accumulates deprecated fields.** Accepted for a service this age;
  the deprecation marker is the record, and removal is a decision with a proposal behind it.
- **A trace identifier in a response leaks the existence of correlation to callers.** Accepted:
  it carries no internal detail, and it is the only way a user can report a problem that an
  operator can find.

## Open Questions

- Whether the disclaimer belongs in the answer's metadata or beside each ranked result. It is
  currently one statement per answer; per-activity text would be more precise for skiing and
  noise for indoor sightseeing.
- Whether a day with no results at all — every activity missing data — should still be returned
  as a day. Returning it is more honest; omitting it is easier for clients. Currently returned.
- Whether the inbound limit should be per address or per address and query shape. Stage 6 §5.4
  cares about the rate of new cache keys, which argues for counting distinct locations rather
  than requests.
