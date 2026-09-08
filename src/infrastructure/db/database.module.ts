import { Global, Inject, Logger, Module, type OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Env } from '../../config/env.schema';
import { DATABASE, type Database, schema } from './database';
import { SchemaGuardService } from './schema-guard.service';

export const DATABASE_POOL: unique symbol = Symbol('DatabasePool');

const logger = new Logger('Database');

/**
 * The store, when there is one.
 *
 * `DATABASE_URL` unset is a supported way to run this service rather than a
 * misconfiguration: the rules come from the repository, the series come from
 * the cache, and a location whose profile is already known still ranks. What is
 * lost is stated in the degradation table and nowhere else (design.md,
 * Decision 2).
 *
 * Global because the store is not a feature of one module: geo writes profiles,
 * activities reads published versions and ranking writes audit, and threading
 * one handle through three imports would say the opposite.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: (config: ConfigService<Env, true>): Pool | undefined => {
        const url = config.get('DATABASE_URL', { infer: true });

        if (url === undefined) {
          logger.warn(
            'DATABASE_URL is unset: running without a store. New locations cannot be profiled ' +
              'and no audit is recorded; everything else works.',
          );

          return undefined;
        }

        // A pool that cannot connect must not stop the start: an unreachable
        // store is degraded through, and readiness is what reports it.
        const pool = new Pool({ connectionString: url });

        pool.on('error', (cause) => logger.error(`Idle client failed: ${cause.message}`));

        return pool;
      },
      inject: [ConfigService],
    },
    {
      provide: DATABASE,
      useFactory: (pool: Pool | undefined): Database | undefined =>
        pool === undefined ? undefined : drizzle(pool, { schema }),
      inject: [DATABASE_POOL],
    },
    SchemaGuardService,
  ],
  exports: [DATABASE, DATABASE_POOL, SchemaGuardService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Optional() @Inject(DATABASE_POOL) private readonly pool: Pool | undefined) {}

  /**
   * A pool holds sockets open, and Nest does not know that. Without this a test
   * that closes its application leaves the process alive, and a rolling restart
   * leaves connections behind on the server.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
