## 1. The query and its input

- [ ] 1.1 Add the input type: one location as a name or as coordinates, optional days. Write a
      failing test that neither-or-both is rejected.
- [ ] 1.2 Express the supported horizon range in the contract; test that the range is
      discoverable from the generated schema, not only from a validator.
- [ ] 1.3 Write a failing test that an out-of-range horizon is rejected with the registry code
      and that no outbound call is made, then implement the validation pipe.
- [ ] 1.4 Test that invalid coordinates are rejected with their own code, distinct from an
      unresolvable name.

## 2. The result types

- [ ] 2.1 Add the three result types and the union; test against the generated schema that the
      union has exactly three members and no nullable score.
- [ ] 2.2 Test that a query selecting the union without covering every member is rejected by the
      schema.
- [ ] 2.3 Add the day and answer types with the metadata `activity-ranking` requires: resolved
      location, time obtained, staleness, profile version, time zone, scope statement.
- [ ] 2.4 Add the explanation type; test that raw value, unit, normalised value and weight or
      limiting factor are all present for a ranked result.
- [ ] 2.5 Test that a dropped feature appears as dropped and not as a zero contribution.
- [ ] 2.6 Add the mappers from domain values to these models; test that no domain type is
      exported through the API and that `src/domain/**` gains no decorator.

## 3. Errors

- [ ] 3.1 Add the exception filter translating domain failures into transport errors with a
      registry code and a trace identifier.
- [ ] 3.2 Write a failing test that a source's own error text never appears in a response, using
      the recorded `error-bad-variable.json` case whose text contains an internal type name.
- [ ] 3.3 Test that an unforeseen exception yields a generic code with a trace identifier and no
      stack, type name or message.
- [ ] 3.4 Test that the trace identifier in the response matches the one in the log record.
- [ ] 3.5 Add a test that every code the API can emit exists in the reason registry, enumerated
      from the registry rather than from a list in the test.

## 4. Protection

- [ ] 4.1 Add the depth limit; test that a query beyond it is rejected before execution.
- [ ] 4.2 Disable Apollo operation batching; test that a batched request is refused.
- [ ] 4.3 Turn introspection off outside development; test both environments.
- [ ] 4.4 Add `@nestjs/throttler` and run the e2e suite with it enabled — this is the
      compatibility check stage-six.md §9.1 asks for. If it fails against Nest 12, implement the
      small limiter over the outbound budget's token bucket instead and record the outcome here.
- [ ] 4.5 Test that a rate-limited request is refused before any outbound call.

## 5. Health

- [ ] 5.1 Replace the current health controller with separate liveness and readiness endpoints.
- [ ] 5.2 Test that readiness is not ready when the store is unreachable or the schema is not at
      head.
- [ ] 5.3 Write a failing test that every weather source being unavailable leaves readiness
      ready, then verify the answer degrades to stale or missing data as the domain requires.

## 6. Evolution

- [ ] 6.1 Snapshot the generated schema in a test; a change to it must be a visible diff in
      review.
- [ ] 6.2 Add a test that every field added since the snapshot is optional.
- [ ] 6.3 Document the deprecation rule in `README.md`: fields are deprecated, not removed, and
      a removal needs a proposal.

## 7. Close-out

- [ ] 7.1 Verify `src/schema.gql` is still generated, gitignored and hook-protected, and that
      nothing in this change edits it.
- [ ] 7.2 Run the acceptance cases of `stage-two.md` §12 end to end through the API and confirm
      each produces the expected outcome type.
- [ ] 7.3 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste the
      output.
- [ ] 7.4 `/security-review` — this is the change that exposes user input to the outside world.
- [ ] 7.5 `/code-review` at level `high`, then `/opsx:archive`.
