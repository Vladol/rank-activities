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
