# rank-activities

A service that ranks activities (**ski / surfing / outdoor sightseeing / indoor
sightseeing**) against the weather forecast from the Open-Meteo API.

Full development plan: [docs/development-flow/flow.md](docs/development-flow/flow.md).
Per-stage deep dives are linked from the table at the top of that file
(stages 1-6 are written; stage 5 fixes the scoring parameters and their contracts,
stage 6 the stack, the data flow and the bottlenecks).

## Stack

NestJS 12 · GraphQL code-first (Apollo Server 5) · TypeScript strict · zod ·
vitest · oxlint. Chosen in stage 6, installed with their first consumer: `undici`,
`cockatiel`, `lru-cache`, Drizzle + PostgreSQL (`pg`), `nestjs-pino`, `prom-client`.
Deliberately **not** in v1: `luxon` (deferred with the timezone debt), `dataloader`
(no multi-location), `@nestjs/cache-manager` (we own the cache port).

## Commands

```bash
npm install --legacy-peer-deps   # the flag is required: npm 10 bug resolving vitest 4 peer deps
npm run start:dev                # watch mode, GraphiQL at http://localhost:3000/graphql
npm run restart                  # free port 3000, rebuild, start
npm run lint                     # oxlint
npm test                         # unit (vitest)
npm run test:e2e                 # e2e
npx tsc --noEmit                 # types
```

## Hard rules

- **Never edit `src/schema.gql`.** It is generated from the decorators on every
  start and is gitignored. A manual edit is silently lost. Change the types and
  resolvers instead — the schema regenerates itself. Edits are blocked by a
  `PreToolUse` hook.
- **`src/domain/**` is the pure core.** No `@nestjs/*`, no `modules/`, no
  `infrastructure/`, no I/O. Dependency arrows point inward only. A violation
  fails the linter (`no-restricted-imports` in `.oxlintrc.json`).
- **An activity is data, not code.** A new activity is a JSON declaration in
  `seeds/` plus a fixture and a test. If it required touching a service, that is
  a design error.
- **Three honest result states:** `Ranked` | `NotApplicable` | `NoData`. Never
  return `score: 0` in place of an honest refusal. Surfing in Prague is
  `NotApplicable` with reason `NO_COASTLINE_NEARBY`, not "poor waves".
- **External responses are validated with zod at the adapter boundary.** Past that
  point only domain types in canonical units travel through the code.
- **Tests and `start:dev` never touch the network.** The development default is the
  recorded sources over the fixtures in `src/modules/weather/adapters/mock/fixtures/`,
  and `test/setup/no-network.ts` fails any test that opens a non-loopback connection.
  A fixture is a recorded response, never a hand-written one: add one with
  `node scripts/record-fixture.ts <name> "<url>"`. Strategy and fixture table:
  [docs/requirements/mocking.md](docs/requirements/mocking.md).
- **The environment is validated at startup** (`src/config/env.schema.ts`). A new
  variable means editing the schema and `.env.example`, not reading
  `process.env.X` in place. A variable missing from `.env.example` fails a test.
- **Cache keys are built only in `src/common/cache/cache-keys.ts`.** `CachePort`
  takes a branded `CacheKey`, so the compiler enforces it; only plain data is
  cached, through an explicit codec per type, and every codec has a round-trip
  test in which a `null` inside a series stays `null`.
- **Cross-cutting behaviour is never written into an adapter.** Cache,
  deduplication, breaker, retry, budget and metrics come from one factory
  (`src/modules/weather/decorators/wrap-source.ts`), in the order stage 4 fixed.
- `noUncheckedIndexedAccess` is on: indexing an hourly series guarantees nothing,
  and Open-Meteo routinely returns `null` inside its series.

## Process: who owns what

Two frameworks must not compete. The split:

| Layer | Owner | Artifact |
|---|---|---|
| Requirements — the "what" and "why" | OpenSpec | `openspec/specs/`, `changes/*/proposal.md` |
| Step-by-step plan | OpenSpec | `changes/*/tasks.md` (written using the `superpowers:writing-plans` method) |
| How we work | superpowers | brainstorming, TDD, verification-before-completion |
| Architectural trade-offs | both | `design.md` for a change, an ADR under `docs/` for cross-cutting decisions |

Chain: `/opsx:explore` → `superpowers:brainstorming` → `/opsx:propose` →
`tasks.md` → TDD → `/code-review` → `/opsx:archive`.

**Open a change proposal** for a new observable capability of the service and for the
three axes of change (new activity / swapping the weather provider / changing the
scoring). Typos, refactors and dependency bumps are ordinary commits with no spec.

Nine capabilities exist; the roadmap and the implementation queue are in
[stage-four.md §15](docs/development-flow/stage-four.md). **The number is the order the
spec was written, not the order to build in** — `07` (caching) has to land before `05`
is finished, and `08` (persistence) before `04` is, because each of those two specs
requires behaviour whose mechanism arrives later.

## Layout

The target layout is described in flow.md §4.3. What exists today:

```
src/config/        # zod environment schema, fail-fast at startup; caching and budget settings
src/common/cache/  # CachePort, memory and null adapters, cache-keys.ts, codecs, single-flight
src/common/metrics/# the counter and gauge registry; Prometheus exports it in stage 7
src/domain/        # pure core: metrics, units, series, Result, location identity and profiles
src/modules/       # health, weather (ports, selection, adapters), activities, geo, ranking, api
src/modules/geo/   # location resolver, applicability profile, marine probe, snow-season evidence
src/modules/ranking/     # the use case: resolve -> applicability -> plan -> fetch -> score -> order
src/modules/api/graphql/ # result models and the mapper; the only place a GraphQL decorator lives
src/modules/weather/decorators/          # the one wrapping factory: observed, cached, resilient
src/modules/weather/outbound-budget/     # token buckets over three windows, counted in attempts
src/modules/weather/adapters/mock/       # recorded sources, fixture registry, rebaser, fixtures
src/modules/weather/adapters/open-meteo/ # zod schema and raw->domain mapper, shared with the live client
scripts/           # record-fixture.ts: the only supported way to add a fixture
test/setup/        # no-network.ts, loaded by both vitest configs
.claude/hooks/     # hooks: lint changed file, block schema.gql edits, verify on Stop
openspec/          # specs and change proposals
```
