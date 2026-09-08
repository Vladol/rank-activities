# rank-activities

A NestJS application.

## Installation

```bash
npm install --legacy-peer-deps
```

> `--legacy-peer-deps` is required because of an npm 10 bug in resolving vitest 4 peer dependencies.

## Running

```bash
npm run start:dev   # watch mode
npm run start       # plain run
npm run start:prod  # from the built dist/

npm run clear       # kill whatever process listens on port 3000
npm run restart     # clear, then rebuild and start in watch mode
```

## Tests and linting

```bash
npm test        # unit (vitest)
npm run test:watch  # unit, watch mode
npm run test:e2e
npm run lint    # oxlint
```

Neither default run touches the network: they answer from recorded fixtures, and
`test/setup/no-network.ts` fails any test that opens a non-loopback connection.

### The integration suite

```bash
npm run test:integration   # starts PostgreSQL in a container via testcontainers
```

It is the only suite that needs a database, and it is separate on purpose:
`npm test` and `npm run test:e2e` must pass with nothing running, and a suite
that always had a database would not notice when that stopped being true. It
runs against a real PostgreSQL rather than a substitute engine, because what it
checks is migrations, partitioning, triggers and check constraints — an
emulation of those would prove something about the emulation.

### The live contract test

```bash
npm run test:contract   # reaches api.open-meteo.com — four requests
```

It validates a live response with the same zod schema the adapter uses, one
request per capability. It is the only mechanism that can notice the recorded
fixtures have gone stale, and the only test in the repository that dials out —
so it has its own configuration (`vitest.config.contract.mts`), runs nightly
through `.github/workflows/live-contract.yml`, and is excluded from `npm test`
and `npm run test:e2e`. A red scheduled run is a task; a red build is a blocked
team.

## The store

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/rank_activities

npm run db:migrate   # a deploy step. The service never migrates itself.
npm run db:seed      # publishes the registries, the rule versions and the
                     # demonstration profiles. Idempotent; safe on every deploy.
npm run db:partitions  # keeps a year of audit partitions provisioned ahead
```

The migration provisions a year of monthly audit partitions and a default one so
that no insert can ever fail for want of a partition. `db:partitions` keeps that
window open, and has to run before the last provisioned month arrives: a row that
lands in the default partition makes its own month's partition impossible to
create, which is the single failure mode a monthly-partitioned table has.

**The service runs without one.** The rules are read from `seeds/` and the series
come from the cache, so development, `npm test` and `npm run test:e2e` need no
database at all. What a store adds is what a restart would otherwise cost:
resolved locations, applicability profiles and the marine probe history — which
is what lets the two-phase probe reach a second day and settle surfing at an
inland location on `NO_COASTLINE_NEARBY` instead of leaving it as missing data
for ever.

At startup the service verifies the schema is the one it expects and exits
non-zero if it is not. It never migrates: migration is a deploy step, and a
service that migrates itself makes every instance a writer during a rolling
restart and turns a failed migration into a crash loop.

When the store is unreachable, a location whose profile this instance already
knows still ranks, a location it has never profiled is refused with
`PROFILE_UNAVAILABLE`, readiness (`/health/ready`) answers 503 and liveness
(`/health/live`) still answers 200 — a liveness probe that went red because a
third party is down would ask the orchestrator to restart a healthy process.

### The assumption: no weather series are stored

**The database holds no hourly or daily series of any kind** — no forecast table,
no marine table, no archive table. What reaches it from the source is
conclusions: a snow-season verdict instead of thirty-one days of archive, a
coverage verdict instead of a wave series.

This is the main assumption of the design and it is worth stating plainly,
because "persist the weather data" reads like an instruction to build that table.
The requirement is that the API is not called on every request, and a cache with
a lifetime satisfies it: a forecast is stale within the hour and a single call
restores it completely (live p95 is 136 ms). A table would satisfy the same
requirement worse — it would be a second, permanently outdated copy of
Open-Meteo, it would need refreshing, invalidating and reconciling, and it would
immediately raise the question of which copy is authoritative.

The rule that decides what goes where is one question — *what happens if this
disappears?* Reproducing a past computation becomes impossible, or re-gathering
it costs several outbound calls and a day of waiting: the database. One 136 ms
call restores it: the cache only. It is derived from the declarations: process
memory. Applied honestly, that rule produces a schema with no series in it.

The full map is [docs/investigation/data-model.md](docs/investigation/data-model.md).

## The weather source

The service reads Open-Meteo. Which source serves which capability is
configuration (`WEATHER_PROVIDER`, and a per-capability override — see
`.env.example`):

| Value | What it does |
|---|---|
| `mock` | Recorded fixtures, no network at all. The development and test default |
| `open-meteo` | The live API |
| `record` | The live API with a fixture writer attached: every response it serves is also written to the fixture set. A decorator over `open-meteo`, never the default, and it refuses to replace an existing recording unless `WEATHER_RECORD_REPLACE=true` |

A source named here but not implemented refuses the start; the service never
substitutes another one.

**The free tier forbids commercial use.** It also needs no API key and applies
three limits, the daily one twelve times stricter than the hourly. The
commercial endpoint is the same API: a different hostname
(`customer-api.open-meteo.com`) and one added `apikey` parameter. Nothing in the
adapter changes for it — it is a host and a query parameter, added when a key
exists.

## GraphQL

Code-first setup with Apollo Server. The SDL in `src/schema.gql` is generated from the
decorators on every app start — do not edit it by hand (it is gitignored).

- Endpoint: `POST http://localhost:3000/graphql`
- GraphiQL: open `http://localhost:3000/graphql` in a browser

```bash
curl -H 'content-type: application/json' \
  -d '{"query":"{ hello }"}' http://localhost:3000/graphql
```

Add a query or mutation by writing a `@Resolver()` class (see `src/app.resolver.ts`)
and registering it in the `providers` of its module.
