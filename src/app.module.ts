import { join } from 'node:path';

import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { validateEnv } from './config/env.schema';
import { ActivitiesModule } from './modules/activities/activities.module';
import { ApiModule } from './modules/api/api.module';
import { GeoModule } from './modules/geo/geo.module';
import { HealthModule } from './modules/health/health.module';
import { WeatherModule } from './modules/weather/weather.module';

@Module({
  imports: [
    // Validate the environment at startup: a bad env kills the process immediately.
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Code-first: the SDL is generated from the decorators on every start.
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      graphiql: process.env.NODE_ENV !== 'production',
    }),
    HealthModule,
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
    // for. The profile store is in-process until `08-add-data-persistence`.
    GeoModule,
    // The scenario itself, and the GraphQL surface over it. The transport rules
    // — error envelope, complexity limits, throttling — are `09-add-graphql-api`.
    ApiModule,
  ],
  providers: [AppResolver, AppService],
})
export class AppModule {}
