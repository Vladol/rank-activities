import { join } from 'node:path';

import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { TraceMiddleware } from './common/trace/trace.middleware';
import { type Env, validateEnv } from './config/env.schema';
import { ActivitiesModule } from './modules/activities/activities.module';
import { ApiModule } from './modules/api/api.module';
import { formatTransportError } from './modules/api/graphql/format-error';
import { stateHorizonRange } from './modules/api/graphql/horizon-in-schema';
import { maxDepthRule } from './modules/api/graphql/max-depth.rule';
import { traceExtensionPlugin } from './modules/api/graphql/trace.plugin';
import { DatabaseModule } from './infrastructure/db/database.module';
import { GeoModule } from './modules/geo/geo.module';
import { WeatherModule } from './modules/weather/weather.module';

@Module({
  imports: [
    // Validate the environment at startup: a bad env kills the process immediately.
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const production = config.get('NODE_ENV', { infer: true }) === 'production';
        const limits = {
          defaultDays: config.get('FORECAST_DAYS_DEFAULT', { infer: true }),
          maxDays: config.get('FORECAST_DAYS_MAX', { infer: true }),
        };

        return {
          // Code-first: the SDL is generated from the decorators on every start.
          autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
          sortSchema: true,
          // The horizon the service actually answers for is stamped into the
          // published contract, so the bound is discoverable rather than only
          // enforced (`graphql-api` design.md, Decision 4).
          transformSchema: (schema) => stateHorizonRange(schema, limits),
          transformAutoSchemaFile: true,
          graphiql: !production,
          // A public endpoint. The schema is generated on every start and lives
          // in the repository, so exploring it costs a checkout rather than a
          // request against production.
          introspection: !production,
          // A batch is one HTTP request carrying many operations: it passes the
          // inbound limiter once for arbitrarily much work, and it breaks the
          // one-request-one-trace-identifier correspondence ADR 0004 depends on.
          allowBatchedHttpRequests: false,
          // A depth limit rather than a cost analyser. The schema is shallow and
          // non-recursive; the amplification this API has is a stream of
          // distinct city names, which the inbound limit is what bounds
          // (stage-six.md, section 2.5).
          validationRules: [maxDepthRule(config.get('GRAPHQL_MAX_DEPTH', { infer: true }))],
          // Both halves of the HTTP exchange, named: the inbound limiter reads
          // the caller's address off the request and writes its headers onto
          // the response, and neither is reachable from a resolver's arguments.
          context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
          plugins: [traceExtensionPlugin()],
          // The last gate: every error leaves with a registry code and a trace
          // identifier, and with nothing else.
          formatError: formatTransportError,
        };
      },
    }),
    // The store, when one is configured. Global, because geo writes profiles,
    // activities reads published versions and ranking writes audit; and
    // optional, because none of those three stop working without it — what is
    // lost is the degradation table of `data-persistence` and nothing else.
    DatabaseModule,
    // The catalogue and the scoring profile, both read from disk at startup and
    // both fatal when invalid: an activity is data, and data that cannot be
    // trusted stops the start rather than surfacing as a wrong number later.
    ActivitiesModule,
    // Binds a source per capability and for place lookup, and refuses to start
    // when the configured source has no implementation. The default is the
    // recorded sources, which read fixtures and never open a socket
    // (docs/requirements/mocking.md).
    WeatherModule.forRoot(),
    // Turns a name or a pair of coordinates into a place with an identity, and
    // decides which activities are possible there before any weather is asked
    // for.
    GeoModule,
    // The scenario itself, the GraphQL surface over it, the inbound limit, the
    // error envelope and the two health signals.
    ApiModule,
  ],
  providers: [AppResolver, AppService],
})
export class AppModule implements NestModule {
  /**
   * The trace scope opens before anything else, on every route.
   *
   * A middleware rather than an interceptor: a request refused by the inbound
   * limiter never reaches an interceptor, and a refusal without an identifier
   * is a refusal nobody can look up (ADR 0004).
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('*path');
  }
}
