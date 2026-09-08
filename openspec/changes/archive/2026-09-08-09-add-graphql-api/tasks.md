## 1. The query and its input

- [x] 1.1 Add the input type: one location as a name or as coordinates, optional days. Write a
      failing test that neither-or-both is rejected.
- [x] 1.2 Express the supported horizon range in the contract; test that the range is
      discoverable from the generated schema, not only from a validator.
      *A decorator is evaluated before configuration is read, so the range is stamped into the
      schema at build time by `transformSchema` (`horizon-in-schema.ts`) and appears in
      `src/schema.gql` and in the checked-in snapshot.*
- [x] 1.3 Write a failing test that an out-of-range horizon is rejected with the registry code
      and that no outbound call is made, then implement the validation pipe.
- [x] 1.4 Test that invalid coordinates are rejected with their own code, distinct from an
      unresolvable name.
      *`INVALID_COORDINATES` against `LOCATION_NOT_FOUND`; a point off the Earth is refused by
      the pipe, before the geocoder is asked.*

## 2. The result types

- [x] 2.1 Add the three result types and the union; test against the generated schema that the
      union has exactly three members and no nullable score.
- [x] 2.2 Test that a query selecting the union without covering every member is rejected by the
      schema.
      *Read as: a query that treats the union as one flat type — `outcome { score }` — is
      refused at validation. GraphQL permits a selection covering only some members, so this is
      the strongest form the schema can enforce.*
- [x] 2.3 Add the day and answer types with the metadata `activity-ranking` requires: resolved
      location, time obtained, staleness, profile version, time zone, scope statement.
- [x] 2.4 Add the explanation type; test that raw value, unit, normalised value and weight or
      limiting factor are all present for a ranked result.
- [x] 2.5 Test that a dropped feature appears as dropped and not as a zero contribution.
- [x] 2.6 Add the mappers from domain values to these models; test that no domain type is
      exported through the API and that `src/domain/**` gains no decorator.
      *`boundary.spec.ts`: every declaration lives under `src/modules/api/graphql/`, the core
      holds none, and a field added to a domain type does not escape through the mapper.*

## 3. Errors

- [x] 3.1 Add the exception filter translating domain failures into transport errors with a
      registry code and a trace identifier.
- [x] 3.2 Write a failing test that a source's own error text never appears in a response, using
      the recorded `error-bad-variable.json` case whose text contains an internal type name.
      *The recorded case is read from `docs/investigation/open-meteo/samples/`. It was not added
      to the mock fixture set: it was captured at Lisbon's coordinates, and a 400 fixture there
      shadows `lisbon-surf` for every recorded forecast read (22 suites failed on the attempt).*
- [x] 3.3 Test that an unforeseen exception yields a generic code with a trace identifier and no
      stack, type name or message.
- [x] 3.4 Test that the trace identifier in the response matches the one in the log record.
- [x] 3.5 Add a test that every code the API can emit exists in the reason registry, enumerated
      from the registry rather than from a list in the test.
      *Four reasons were added to the registry, because the API emitted codes it did not
      declare: `INVALID_LOCATION_INPUT`, `RATE_LIMITED`, `INVALID_QUERY` and `INTERNAL_ERROR`.
      The last has a new kind, `internal`, which migration `0007_reason_kinds` admits.*

## 4. Protection

- [x] 4.1 Add the depth limit; test that a query beyond it is rejected before execution.
      *Written here rather than taken from a plugin: `@escape.tech/graphql-armor-max-depth`
      **throws** out of the validation phase instead of reporting through it, which turns a
      client's mistake into `INTERNAL_ERROR` and loses the registry code. `max-depth.rule.ts` is
      thirty lines and reports properly; the dependency was installed, measured and removed.*
- [x] 4.2 Disable Apollo operation batching; test that a batched request is refused.
- [x] 4.3 Turn introspection off outside development; test both environments.
- [x] 4.4 Add `@nestjs/throttler` and run the e2e suite with it enabled — this is the
      compatibility check stage-six.md §9.1 asks for. If it fails against Nest 12, implement the
      small limiter over the outbound budget's token bucket instead and record the outcome here.
      **Outcome: it works.** `@nestjs/throttler` 6.5.0 installs under `--legacy-peer-deps`
      (its peer range ends at `@nestjs/common ^11`) and the whole e2e suite passes with the
      guard enabled. One adaptation was needed and is not a compatibility fault: under GraphQL
      the HTTP arguments hold the resolver's arguments, so `GraphqlThrottlerGuard` reads the
      request and response off the GraphQL context. The fallback limiter was not needed.
- [x] 4.5 Test that a rate-limited request is refused before any outbound call.

## 5. Health

- [x] 5.1 Replace the current health controller with separate liveness and readiness endpoints.
      *Moved to `src/modules/api/health/` and the bare `GET /health` removed: a single word for
      two questions answers neither. **`@nestjs/terminus` was not used.** It was installed,
      and its `HealthCheckService` answers with its own body shape, which would have broken the
      `{ status, store, detail }` contract that `08-add-data-persistence` already established
      and tests in two suites. A dependency whose only effect is to break a tested contract is
      not worth its peer range; this deviates from the proposal's dependency list deliberately.*
- [x] 5.2 Test that readiness is not ready when the store is unreachable or the schema is not at
      head.
- [x] 5.3 Write a failing test that every weather source being unavailable leaves readiness
      ready, then verify the answer degrades to stale or missing data as the domain requires.

## 6. Evolution

- [x] 6.1 Snapshot the generated schema in a test; a change to it must be a visible diff in
      review. *`test/schema.snapshot.graphql`, since `src/schema.gql` is gitignored.*
- [x] 6.2 Add a test that every field added since the snapshot is optional.
- [x] 6.3 Document the deprecation rule in `README.md`: fields are deprecated, not removed, and
      a removal needs a proposal.

## 7. Close-out

- [x] 7.1 Verify `src/schema.gql` is still generated, gitignored and hook-protected, and that
      nothing in this change edits it.
- [x] 7.2 Run the acceptance cases of `stage-two.md` §12 end to end through the API and confirm
      each produces the expected outcome type.
      *`test/api-acceptance.e2e-spec.ts`. Only the cases a forecast horizon can serve are
      reachable: Chamonix in summer, Tromsø in December, Dubai in July, the Galway storm and the
      flat Odessa sea are recorded over past windows, and the query takes no start date. They
      stay asserted in `test/acceptance/` against the same recordings. The München row is
      likewise unreachable — its recorded evidence is an HTTP 403 — and became the test that the
      vendor's HTML reaches nobody.*
- [x] 7.3 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste the
      output.
      ```
      npm run lint         clean
      npx tsc --noEmit     clean
      npm test             Test Files 106 passed (106) · Tests 1090 passed | 2 skipped
      npm run test:e2e     Test Files  11 passed  (11) · Tests   52 passed
      npm run test:integration  Test Files 8 passed (8) · Tests 97 passed
      ```
      *The integration run reports one unhandled `57P01` from `degradation.spec.ts`, which stops
      its own container while a pool is open. It predates this change and no test fails on it.*
- [ ] 7.4 `/security-review` — this is the change that exposes user input to the outside world.
- [ ] 7.5 `/code-review` at level `high`, then `/opsx:archive`.
