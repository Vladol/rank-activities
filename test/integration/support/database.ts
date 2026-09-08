import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';

import { type Database, schema } from '../../../src/infrastructure/db/database';
import { applyMigrations } from '../../../src/infrastructure/db/migrate';
import { migrationsDir } from '../../../src/infrastructure/db/migrations-dir';
import { readMigrations } from '../../../src/infrastructure/db/migrations';
import { sqlState } from '../../../src/infrastructure/db/pg-error';

export interface TestDatabase {
  readonly db: Database;
  readonly pool: Pool;
  readonly url: string;
  close(): Promise<void>;
}

/**
 * A database of its own, empty, inside the shared container. A file that
 * created tables must not be able to change what the next file sees, and
 * truncating between files would leave the schema — which is the thing several
 * of these tests are about.
 */
export async function emptyDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('postgresUrl');
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl });

  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  const pool = new Pool({ connectionString: url.href });

  return {
    db: drizzle(pool, { schema }),
    pool,
    url: url.href,
    close: () => pool.end(),
  };
}

/** The same, with the deploy step already run against it. */
export async function migratedDatabase(): Promise<TestDatabase> {
  const database = await emptyDatabase();

  await applyMigrations(database.db);

  return database;
}

/**
 * The store's refusal of a write, as its SQLSTATE and its message.
 *
 * A test that asserts a rejection and nothing more passes when the write fails
 * for an unrelated reason — a typo in the SQL rejects too. Naming the code is
 * what makes "the store refused this, for this reason" an assertion.
 */
export async function refusalOf(
  write: Promise<unknown>,
): Promise<{ readonly code: string | undefined; readonly message: string }> {
  try {
    await write;
  } catch (cause) {
    return { code: sqlState(cause), message: messageOf(cause) };
  }

  throw new Error('The store accepted a write that it was expected to refuse.');
}

/** Drizzle's wrapper carries the driver's message one level down. */
function messageOf(cause: unknown): string {
  const messages: string[] = [];

  for (let current = cause; current instanceof Error; current = (current as { cause?: unknown }).cause) {
    messages.push(current.message);
  }

  return messages.join(' | ');
}

/**
 * A database migrated only part of the way, which is what a deploy looks like
 * between the migration step and the one before it.
 *
 * It runs the SQL and records the hashes exactly as Drizzle's own migrator
 * would, because a store that merely *says* it is behind proves nothing about a
 * guard that compares hashes.
 */
export async function partiallyMigratedDatabase(applied: number): Promise<TestDatabase> {
  const database = await emptyDatabase();
  const migrations = readMigrations();

  await database.pool.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await database.pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )
  `);

  for (const [at, migration] of migrations.slice(0, applied).entries()) {
    const sqlText = readFileSync(join(migrationsDir(), `${migration.tag}.sql`), 'utf8');

    for (const statement of sqlText.split('--> statement-breakpoint')) {
      await database.pool.query(statement);
    }

    await database.pool.query(
      'INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
      [migration.hash, at],
    );
  }

  return database;
}

/**
 * Takes the store away, the way an outage does: every backend is killed and no
 * new connection is accepted.
 *
 * It is not a mocked failure. The degradation table is a promise about what
 * happens when PostgreSQL is not there, and a fake rejection would only prove
 * something about the fake (design.md, "Risks / Trade-offs").
 */
export async function disconnect(database: TestDatabase): Promise<void> {
  const name = new URL(database.url).pathname.slice(1);
  const admin = new Pool({ connectionString: inject('postgresUrl') });

  try {
    await admin.query(`ALTER DATABASE ${name} WITH ALLOW_CONNECTIONS false`);
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
      name,
    ]);
  } finally {
    await admin.end();
  }
}
