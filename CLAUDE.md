# rank-activities

A service that ranks activities (**ski / surfing / outdoor sightseeing / indoor
sightseeing**) against the weather forecast from the Open-Meteo API.

Full development plan: [docs/development-flow/flow.md](docs/development-flow/flow.md).
Stage 1 status: [docs/development-flow/stage-one.md](docs/development-flow/stage-one.md).

## Stack

NestJS 12 · GraphQL code-first (Apollo Server 5) · TypeScript strict · zod ·
vitest · oxlint · Drizzle + PostgreSQL (arrives in stage 6).

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
- **The environment is validated at startup** (`src/config/env.schema.ts`). A new
  variable means editing the schema and `.env.example`, not reading
  `process.env.X` in place.
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

**Open a change proposal only** for the initial domain spec and for the three axes
of change (new activity / swapping the weather provider / changing the scoring).
Typos, refactors and dependency bumps are ordinary commits with no spec.

## Layout

The target layout is described in flow.md §4.3. What exists today:

```
src/config/        # zod environment schema, fail-fast at startup
src/domain/        # pure core (empty for now, filled from stage 4)
src/modules/       # health; then weather, geo, activities, ranking, api
.claude/hooks/     # hooks: lint changed file, block schema.gql edits, verify on Stop
openspec/          # specs and change proposals
```
