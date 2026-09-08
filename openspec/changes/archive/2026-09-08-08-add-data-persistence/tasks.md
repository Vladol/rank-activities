## 1. Schema and migrations

- [x] 1.1 Add the Drizzle schema for the reference tables (`metrics`, `reason_codes`);
      install `drizzle-orm`, `drizzle-kit` and `pg` with this task.
- [x] 1.2 Add the rules tables with `UNIQUE (code, version)`; write a test that an update of a
      published row is rejected by the store, not by the service.
- [x] 1.3 Add `locations` with the unique grid key, and the check constraints on coordinates.
- [x] 1.4 Add `location_profiles` and `marine_probes`; make `(location_id, local_date)` the
      primary key and test that a duplicate same-day probe is impossible.
- [x] 1.5 Add the place-lookup table with the paired found/result check; test that a "found
      with no result" row is rejected.
- [x] 1.6 Add the audit tables with their partitioning and the ranked-implies-score check.
- [x] 1.7 Generate the six migrations in the order of `data-model.md` §9; test that applying
      them to an empty database produces the expected schema.
- [x] 1.8 Add the indexes of `data-model.md` §2.6, each with the query it serves named in a
      comment. No index without a query.

## 2. Startup discipline

- [x] 2.1 Add `migration-guard.ts`: verify the schema is at head at startup.
- [x] 2.2 Write a failing test that a service started against an out-of-date schema exits
      non-zero and names the expected and found state.
- [x] 2.3 Test that starting changes nothing in the schema, including several instances
      starting concurrently.
- [x] 2.4 Verify no migration runs as part of `npm run start:dev`.

## 3. Publication of rules

- [x] 3.1 Add the seed that publishes declarations and profiles idempotently by code and
      version.
- [x] 3.2 Write a failing test, then implement the checksum comparison: republishing identical
      content succeeds and changes nothing.
- [x] 3.3 Test that publishing different content under an already-published version fails and
      names the version and the difference.
- [x] 3.4 Test that a computation recorded against an old version can still retrieve that
      version's content after a newer one is published.

## 4. Catalogue behind two adapters

- [x] 4.1 Extract the shared catalogue contract suite from the tests of `03`.
- [x] 4.2 Add the store-backed catalogue adapter; run the shared suite against both it and the
      file adapter, unchanged.
- [x] 4.3 Test that the service starts, loads and validates rules with no store available.
- [x] 4.4 Add the in-memory registry's version check on a lifetime, and test that a newly
      published version is picked up without a restart.

## 5. Location, profile and probe stores

- [x] 5.1 Replace the in-memory profile store from `04` with the durable adapter behind the
      same port; the port does not change.
- [x] 5.2 Test that the identifier is computed before any write and is identical across two
      instances with separate stores.
- [x] 5.3 Write the failing test that `04` could not satisfy: probe, restart, probe on a later
      local date, expect a confirmed inapplicable decision that survives another restart.
- [x] 5.4 Test that concurrent requests produce at most one probe for a location on one local
      date.
- [x] 5.5 Test that "not yet decided" snow-season evidence is distinguishable from a negative
      conclusion, at the store level and through the port.
- [x] 5.6 Seed the demonstration locations' profiles so a fresh checkout has a warm path.

## 6. Audit

- [x] 6.1 Add the buffer and periodic flush; test that answering does not wait for a write.
- [x] 6.2 Test that an unavailable store loses records without affecting answers, and that the
      loss is counted.
- [x] 6.3 Test that the recorded inputs are aggregated feature values, not series.

## 7. Degradation

- [x] 7.1 Write a failing test with the store disconnected: a known location still ranks.
- [x] 7.2 Test that a new location is refused with the profile-unavailable reason, distinct
      from a location that could not be resolved.
- [x] 7.3 Test that readiness reports not ready when the store is unavailable or the schema is
      not at head, and that liveness is unaffected by the weather source.
- [x] 7.4 Add the reason code for an unavailable profile to the registry `05` defines; verify
      no free-form string is introduced.

## 8. Test infrastructure

- [x] 8.1 Add `@testcontainers/postgresql` for the integration suite only.
- [x] 8.2 Verify `npm test` and `npm run test:e2e` pass with no database and no network.
- [x] 8.3 Add the integration suite to CI as a separate job with the container.

## 9. Close-out

- [x] 9.1 State in `README.md` the assumption behind Decision 1: no weather series are stored,
      and why the cache satisfies "do not call the API on every request".
- [x] 9.2 Update `docs/investigation/data-model.md` §11 with anything implementation changed.
- [x] 9.3 Run `npm run lint`, `npm test`, `npm run test:e2e`, `npx tsc --noEmit` and paste the
      output.
- [x] 9.4 `/code-review` at level `high`, then `/opsx:archive`.
