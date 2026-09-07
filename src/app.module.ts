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
  ],
  providers: [AppResolver, AppService],
})
export class AppModule {}
