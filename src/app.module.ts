import { join } from 'node:path';

import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { validateEnv } from './config/env.schema';
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
    // Binds a source per capability and for place lookup, and refuses to start
    // when the configured source has no implementation. The default is the
    // recorded sources, which read fixtures and never open a socket
    // (docs/requirements/mocking.md).
    WeatherModule.forRoot(),
  ],
  providers: [AppResolver, AppService],
})
export class AppModule {}
