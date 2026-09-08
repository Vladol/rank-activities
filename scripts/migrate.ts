import 'reflect-metadata';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { applyMigrations } from '../src/infrastructure/db/migrate';
import { schema } from '../src/infrastructure/db/database';

/**
 * The deploy step. The service never runs this — it verifies the schema and
 * refuses to start against one it does not recognise (ADR 0003).
 *
 * Reference data is not touched here: a migration changes the shape and a seed
 * changes the content, so declarations, profiles and the registries arrive
 * through `db:seed` (spec, "Reference data arrives by publication, not by
 * migration").
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is required to migrate. There is nothing to migrate without one.');
  }

  const pool = new Pool({ connectionString: url });

  try {
    await applyMigrations(drizzle(pool, { schema }));
    console.log('Schema is at head.');
  } finally {
    await pool.end();
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
