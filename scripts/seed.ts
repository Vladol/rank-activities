import 'reflect-metadata';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { schema } from '../src/infrastructure/db/database';
import { seedDemonstrationProfiles } from '../src/infrastructure/db/seed/demonstration-locations';
import { seed } from '../src/infrastructure/db/seed/seed';

/**
 * The publication step of a deploy, after the migration step and before the new
 * instances start. Idempotent, so it runs on every deploy; it fails the deploy
 * when a published version has been edited rather than raised.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is required to publish. There is nothing to publish into.');
  }

  const pool = new Pool({ connectionString: url });

  try {
    const db = drizzle(pool, { schema });
    const report = await seed(db);
    // Offline: the evidence comes from the recorded fixtures, so a fresh
    // checkout has a warm path without a network and without a quota.
    const warmed = await seedDemonstrationProfiles(db);

    console.log(
      `Published ${report.metrics} metrics and ${report.reasonCodes} reason codes.\n` +
        `Rules published: ${[...report.activities.published, ...report.profiles.published].join(', ') || '(none)'}\n` +
        `Rules already published: ${[...report.activities.unchanged, ...report.profiles.unchanged].join(', ') || '(none)'}\n` +
        `Demonstration locations profiled: ${warmed.join(', ') || '(none)'}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
