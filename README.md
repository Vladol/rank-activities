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
