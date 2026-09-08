# syntax=docker/dockerfile:1

# One image, three uses: it serves the API, and it performs the migration and
# the publication that a deploy runs before the API starts. They share an image
# because they must share a build — a migration applied by one version of the
# code and verified by another is the failure ADR 0003 exists to prevent.

# Node 22 is what CI runs; `engines` asks for >= 20.19.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --legacy-peer-deps is not optional here: npm 10 mis-resolves vitest 4's peer
# dependencies, and the install fails without it (CLAUDE.md, Commands).
RUN npm ci --legacy-peer-deps

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json nest-cli.json ./
COPY tsconfig.json tsconfig.build.json tsconfig.scripts.json ./
COPY src ./src
COPY scripts ./scripts
# Emits both: dist/ for the service, dist-scripts/ for the deploy steps.
RUN npm run build

# Installed separately rather than pruned from the build stage, so that the
# runtime layers never contain a devDependency at any point in their history.
FROM node:22-alpine AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=production-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-scripts ./dist-scripts

# The four directories of data the code reads from disk, resolved against the
# working directory rather than against a module's own location (see the comment
# in `src/infrastructure/db/migrations-dir.ts` for why). Compiled output alone
# would leave every one of these readers with nothing to read:
#
#   migrations         the SQL the migration step applies
#   activities/seeds   the activity declarations the publication step reads
#   scoring/seeds      the scoring profiles the same step publishes
#   mock/fixtures      the recorded responses `seedDemonstrationProfiles`
#                      profiles the demonstration locations from — the seed
#                      reaches no network, so these are a dependency of the
#                      deploy, not only of the mock source
#
# `grep -rn 'process.cwd()' src/` lists exactly these four plus the generated
# SDL below; a fifth one added later shows up as an ENOENT at startup, which is
# the failure this service prefers to a quiet half-configured start.
COPY src/infrastructure/db/migrations ./src/infrastructure/db/migrations
COPY src/modules/activities/seeds ./src/modules/activities/seeds
COPY src/modules/scoring/seeds ./src/modules/scoring/seeds
COPY src/modules/weather/adapters/mock/fixtures ./src/modules/weather/adapters/mock/fixtures

# The GraphQL SDL is generated into `src/schema.gql` on every start (code-first;
# the file is the build's own output, never an input), so this one directory has
# to be writable by the unprivileged user the container runs as.
RUN chown -R node:node /app/src
USER node

EXPOSE 3000

CMD ["node", "dist/main"]
