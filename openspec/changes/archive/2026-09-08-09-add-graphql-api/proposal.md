## Why

The assignment names two things about the stack: Node.js and **GraphQL**. Five specs describe
what an answer must contain and mean, and none of them describes the API that carries it.
`05-add-activity-ranking` says so in as many words — "the transport contract — GraphQL type
names, error envelope, complexity limits, throttling … is `graphql-api`" — and that capability
was never created. The service is currently specified down to the shape of a feature's
explanation and left unspecified at the only surface a user actually touches.

That gap is not merely a missing document, because three decisions already taken elsewhere have
nowhere to live and quietly become optional:

- **The union is the contract.** `activity-ranking` requires three distinguishable outcomes per
  activity and a partial failure that costs one activity rather than the answer. Expressed as a
  GraphQL union at the activity level, a client that forgets `NoData` fails to compile. Expressed
  as nullable fields — the path of least resistance for a resolver — the same requirement becomes
  a convention, and the zero it exists to forbid comes back as `score: null`.
- **The line between an error and a state is a contract decision.** `LOCATION_NOT_FOUND` is a
  failed request; `NotApplicable` is a successful answer about an impossible activity. Nothing
  currently requires them to be carried differently, and merging them would erase the distinction
  the whole domain is built on.
- **A public GraphQL endpoint without limits is a denial-of-service vector.** Stage 6 settled
  what to do — bound the domain in the contract itself, add a depth limit, disable Apollo's
  operation batching because it slips past the inbound throttler, turn introspection off in
  production — and none of it is a requirement anywhere.

Two facts from earlier stages make this urgent rather than tidy. The service already forbids
editing the generated SDL by hand, enforced by a hook, so the contract can only be shaped by
the types and resolvers this change specifies. And stage 6 §5.4 measured how the API becomes
the source's problem: a thousand invented city names is a thousand outbound calls, so the
inbound limit is part of protecting the quota, not only of protecting us.

## What Changes

- **One query taking one location and a bounded horizon**, with the domain's own limits
  expressed in the contract rather than checked after the fact, and an out-of-range horizon
  rejected as an error rather than shortened.
- **An activity result is a union at the activity level** — ranked, inapplicable or missing
  data — so that a partial failure is representable and a client cannot silently ignore a state.
- **A ranked result carries its explanation in the response**: per feature the metric, the raw
  aggregated value with its unit, the normalised value and the weight or limiting factor.
- **Request failures are transport errors carrying a code from the reason registry and a trace
  identifier**; everything else is a state inside the data. Neither the source's own error text,
  nor an invalid body, nor an internal exception ever crosses the boundary.
- **API models are distinct from domain types**, assembled by mappers, so renaming a domain type
  is not a breaking change to the contract.
- **The schema is generated from the code and never edited**, and the generated file is not the
  source of truth for anything.
- **Evolution is additive by rule**: new fields are optional, superseded fields are deprecated
  rather than removed, and a removal is a deliberate breaking change with a stated reason.
- **The endpoint is bounded**: a depth limit, operation batching disabled, introspection off in
  production, and an inbound request limit whose purpose is as much the source's quota as our own
  capacity.
- **Liveness and readiness say different things**, and the availability of the weather source is
  in neither — a source outage must not remove from rotation a service that can still answer from
  cached data.

**Out of scope, deliberately:**

- Metrics, structured logging and tracing beyond the trace identifier that must appear in an
  answer. That is `service-observability`, still held as [ADR 0004](../../../docs/adr/0004-observability-contract.md).
- Multi-location requests, hourly ranking and personal scoring profiles. The contract is shaped
  so each is an additive change; none is built.
- Authentication and authorisation. There is no user model and nothing to protect per user; the
  inbound limit is by client address.
- A query-cost analyser. Stage 6 ranks it second: the schema is shallow and non-recursive, so a
  depth limit plus the domain bounds cover what exists today. It returns with multi-location.

## Capabilities

### New Capabilities

- `graphql-api`: the surface that carries the answer — the query and its bounds, the union that
  makes every outcome explicit, the boundary between a failed request and a reported state,
  containment of internal detail, schema generation and additive evolution, endpoint protection,
  and what liveness and readiness each mean.

### Modified Capabilities

None. `activity-ranking` states what an answer must contain and mean; this change states how it
is carried, without restating any of it.

## Impact

| Area | Effect |
|---|---|
| `src/modules/api/graphql/` | Resolvers, view models, inputs and mappers from domain types |
| `src/modules/api/graphql/models/` | The activity-result union and the explanation type |
| `src/common/errors/` | The exception filter mapping domain failures onto transport errors |
| `src/modules/api/health/` | Liveness and readiness split, readiness bound to the store |
| `src/app.module.ts` | Depth limit, batching disabled, introspection by environment |
| `src/schema.gql` | Regenerated; remains generated, gitignored and hook-protected |
| `openspec/changes/05-add-activity-ranking` | Prerequisite: what the answer must contain |
| `openspec/changes/08-add-data-persistence` | Prerequisite: readiness depends on the store and its schema |
| Dependencies | `@nestjs/throttler` (⚠️ peer range ends at Nest 11 — stage 6 §9.1), a depth-limit plugin, `@nestjs/terminus` |
