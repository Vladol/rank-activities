import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { GraphqlExceptionFilter } from '../../common/errors/graphql-exception.filter';
import type { Env } from '../../config/env.schema';
import { RankingModule } from '../ranking/ranking.module';
import { RankingInputPipe } from './graphql/ranking-input.pipe';
import { RankingResolver } from './graphql/ranking.resolver';
import { HealthModule } from './health/health.module';
import { GraphqlThrottlerGuard } from './throttler/graphql-throttler.guard';

/**
 * The transport layer, and the only place a GraphQL decorator appears. What it
 * exposes is decided by the models beside it, never by the shape of a domain
 * type that happened to be returned.
 *
 * The guard and the filter are registered here rather than in `main.ts` because
 * they are this layer's behaviour: what a refused request looks like and what a
 * caller is never told are properties of the surface, not of the process.
 */
@Module({
  imports: [
    RankingModule,
    HealthModule,
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            // Seconds in the environment, milliseconds in the library. The
            // conversion is here so the variable reads like the sentence that
            // describes it.
            ttl: config.get('INBOUND_RATE_WINDOW_SECONDS', { infer: true }) * 1000,
            limit: config.get('INBOUND_RATE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
  ],
  providers: [
    RankingResolver,
    RankingInputPipe,
    { provide: APP_GUARD, useClass: GraphqlThrottlerGuard },
    { provide: APP_FILTER, useClass: GraphqlExceptionFilter },
  ],
})
export class ApiModule {}
