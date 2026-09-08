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

## Running in Docker

The whole stack — the API and its PostgreSQL — with one command:

```bash
docker compose up -d --build
```

Then GraphiQL is at http://localhost:3000/graphql and readiness at
http://localhost:3000/health/ready, which answers `{"status":"ready","store":"at_head"}`
once the schema is in place.

Three services come up, in this order:

| Service | Image | What it is |
|---|---|---|
| `db` | `postgres:17-alpine` | The store, on a named volume. Everything else waits for its health check, not merely for its process |
| `migrate` | this repository | The deploy step: `db:migrate`, then `db:seed`, then `db:partitions`. Runs to completion and stops |
| `api` | this repository | Starts only after `migrate` exits successfully |

**Migrations run on the first start, and on every start after it.** They are a
separate container rather than the API's entrypoint, because the service
verifies the schema and refuses to start against one it does not recognise, but
never migrates itself ([ADR 0003](docs/adr/0003-migrations-as-a-deploy-step.md)):
several instances starting at once then perform no schema change between them,
and a failed migration is a failed deploy instead of a crash loop across every
instance. All three steps are idempotent — migrations by their journal,
publication by `(code, version)`, partitions by `ensure_audit_partition` — so a
second `up` publishes nothing and changes nothing.

The API in this stack reads its rules **from the store**
(`ACTIVITY_CATALOGUE_SOURCE=store`), which is what the publication step exists to
fill, and it reads the **live** Open-Meteo API by default.

There is deliberately **no Redis**. The cache port has a `memory` adapter and a
`null` one and nothing else, `REDIS_URL` is read by no code, and a service that
nothing connects to is a service that only appears to be part of the stack. It
arrives together with the adapter that would use it, when a second instance makes
the arithmetic change ([stage-six.md](docs/development-flow/stage-six.md) §2.3).

### Configuration

Your `.env` is passed to both containers as it is, so every setting in it —
cache lifetimes, the outbound budget, the inbound limit — applies unchanged. It
is optional: the environment schema has a default for everything.

Four values are set by `compose.yaml` itself and win over the file:

| Setting | Why it is not taken from `.env` |
|---|---|
| `DATABASE_URL` | `localhost` inside a container means that container. It points at the `db` service; change the credentials through `POSTGRES_*` below, which the database reads from the same values |
| `ACTIVITY_CATALOGUE_SOURCE=store` | The point of running with a database |
| `PORT=3000` | A `PORT` in someone's `.env` would move the listener without moving the published port |
| `NODE_ENV` | Defaults to `development`, so GraphiQL is reachable. Set `NODE_ENV=production` for a production-shaped run |

Everything else is an ordinary variable, read from `.env` or from your shell:

```bash
WEATHER_PROVIDER=mock docker compose up -d   # the whole stack, no network at all
```

| Variable | Default | What it does |
|---|---|---|
| `WEATHER_PROVIDER` | `open-meteo` | The weather source, as everywhere else |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / `postgres` / `rank_activities` | The database and the credentials, used by both `db` and `DATABASE_URL` |
| `API_HOST_PORT` | `3000` | Where the API is published on the host |
| `POSTGRES_HOST_PORT` | `5433` | Where PostgreSQL is published on the host. **Not 5432**: a developer machine very often already has one there, and the API reaches the store over the compose network regardless |

### Everyday commands

```bash
docker compose logs -f api          # follow the service
docker compose logs migrate         # what the deploy step did
docker compose ps                   # health of each service

docker compose exec db psql -U postgres -d rank_activities   # look inside

docker compose up -d --build        # rebuild after a code change
docker compose down                 # stop, keep the data
docker compose down -v              # stop and drop the volume: the next up is a first run again
```

The API has no restart policy on purpose. The environment is validated at
startup and a bad one exits non-zero — a fatal misconfiguration should be
visible at once rather than hidden inside a restart loop.

While the stack is up it holds host port 3000, and `npm run test:integration`
boots the real application on that port — the suite fails with `EADDRINUSE`
against a running stack. Stop the one container before running it, or publish
the API somewhere else:

```bash
docker compose stop api          # the store stays up
API_HOST_PORT=3001 docker compose up -d
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

npm run build        # the three steps below run compiled output, see the note

npm run db:migrate   # a deploy step. The service never migrates itself.
npm run db:seed      # publishes the registries, the rule versions and the
                     # demonstration profiles. Idempotent; safe on every deploy.
npm run db:partitions  # keeps a year of audit partitions provisioned ahead
```

They run `dist-scripts/`, built by `npm run build` alongside the application,
rather than `scripts/*.ts` directly. Node executes a `.ts` file by stripping its
types, decides the module system from its syntax, sees `import` and treats the
file as ESM — and ESM demands an extension on every relative specifier, which
this codebase does not write. Run from source, the very first import fails to
resolve. Compiling them removes the question: a deploy then applies its
migrations with the same CommonJS the service runs, no loader and no
devDependency involved (`tsconfig.scripts.json`).

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
decorators on every app start — do not edit it by hand (it is gitignored, and a hook
blocks the edit). `test/schema.snapshot.graphql` is the same file, checked in: a change
to the published contract shows up as a diff there in review.

- Endpoint: `POST http://localhost:3000/graphql`
- GraphiQL: open `http://localhost:3000/graphql` in a browser (development only)

```bash
curl -H 'content-type: application/json' \
  -d '{"query":"{ hello }"}' http://localhost:3000/graphql
```

Add a query or mutation by writing a `@Resolver()` class (see `src/app.resolver.ts`)
and registering it in the `providers` of its module.

### The one query

`rankActivities(input: RankingInput!)` takes exactly one location — a name **or** a
pair of coordinates, never both and never neither — and an optional horizon. The
supported range of days is written into the schema itself, and a longer horizon is
**refused** with `HORIZON_TOO_LARGE` rather than quietly shortened: answering four days
to a request for ten is a different answer given silently.

Each activity's result for a day is a **union of three types** — `RankedOutcome`,
`NotApplicableOutcome`, `NoDataOutcome` — placed on the activity rather than on the
answer. A client that forgets a member does not compile; a marine outage costs the
answer surfing and nothing else. There is deliberately no nullable `score`: `null`
standing in for "impossible here" is the same lie as `0`.

### What is an error and what is a state

A request that could not be understood is a transport error. An answer about a place
where an activity is impossible is a successful response.

| | Carried as | Example |
|---|---|---|
| The request was wrong | an error with a code and a `traceId` | `INVALID_LOCATION_INPUT`, `HORIZON_TOO_LARGE`, `INVALID_COORDINATES`, `LOCATION_NOT_FOUND` |
| The answer is that it is impossible | data, inside a successful response | `NotApplicableOutcome(NO_COASTLINE_NEARBY)` |
| The answer is that we do not know | data, inside a successful response | `NoDataOutcome(MARINE_UNAVAILABLE)` |

Every code comes from one registry (`src/domain/shared/reason-code.ts`), so a client
learns one vocabulary. **Nothing else leaves the process**: no source's error text, no
invalid body, no stack, no internal type name. What happened is in the log record that
the `traceId` on the response points at — and every response carries one, successful or
not.

### Evolution: additive by rule

- A new field on an existing type is **optional**. An existing query must keep answering
  identically.
- A superseded field is **deprecated**, not removed. The marker is the record.
- A removal is a **breaking change** and needs a proposal stating the reason. It is never
  a side effect of a refactor.

`test/schema-evolution.e2e-spec.ts` enforces the first two against the checked-in
snapshot.

### The endpoint's bounds

| Measure | Setting | Why |
|---|---|---|
| Query depth | `GRAPHQL_MAX_DEPTH` | The schema is shallow and non-recursive; a depth limit costs nothing and a cost analyser would defend against a shape this schema does not have |
| Operation batching | off, always | A batch passes the inbound limiter once for arbitrarily much work, and breaks the one-request-one-`traceId` correspondence |
| Introspection | off in production | The schema is generated on every start and lives in the repository |
| Inbound rate | `INBOUND_RATE_LIMIT`, `INBOUND_RATE_WINDOW_SECONDS`, per client address | A flood of invented city names is a flood of outbound calls: this protects the source's quota as much as our own capacity. The refusal happens before any outbound call |

There is no authentication: there is no user model and nothing to protect per user.

### Health

`GET /health/live` says the process is running. `GET /health/ready` says whether this
instance should be given traffic — the store reachable and its schema at head. The
availability of the weather source is in **neither**: a source outage that emptied the
rotation would silence a service that could still answer from cached data and mark it
stale. There is no third endpoint meaning both at once.
