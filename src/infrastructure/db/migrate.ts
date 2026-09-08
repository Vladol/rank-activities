import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { Database } from './database';
import { migrationsDir } from './migrations-dir';

/**
 * Applies the migration set. It is called by the deploy step and by the
 * integration suite, and by nothing that runs when the service starts: the
 * service verifies the schema and never changes it (ADR 0003).
 *
 * Making every instance a writer during a rolling restart turns a failed
 * migration into a crash loop and makes the order two pods happen to boot in a
 * factor in whether the schema is correct.
 */
export async function applyMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsDir() });
}
