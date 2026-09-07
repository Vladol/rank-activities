import { join } from 'node:path';

import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { validateEnv } from './config/env.schema';
import { HealthModule } from './modules/health/health.module';

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
    // WeatherModule is deliberately not imported yet. It binds a source per
    // capability and refuses to start when the configured source has no
    // implementation — and this change ships the contract, not a source, so
    // importing it here would make every start fail. It is wired in
    // `02-add-mock-weather-provider`, which registers the recorded sources
    // (task 7.1 there). Until then the binding is covered by
    // src/modules/weather/weather.module.spec.ts.
  ],
  providers: [AppResolver, AppService],
})
export class AppModule {}
