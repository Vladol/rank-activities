import 'reflect-metadata';

import { Pool } from 'pg';

/**
 * Provisions the audit partitions ahead of time.
 *
 * The migration creates a year's worth; this keeps the window open. It has to
 * run before the last provisioned month arrives, because a row that lands in the
 * default partition makes its own month's partition impossible to create — which
 * is the one failure mode a monthly-partitioned table has, and the reason the
 * function refuses with a sentence instead of a constraint error.
 */
const MONTHS_AHEAD = 12;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is required to provision partitions.');
  }

  const pool = new Pool({ connectionString: url });

  try {
    const created: string[] = [];

    for (let month = 0; month <= MONTHS_AHEAD; month += 1) {
      const result = await pool.query<{ ensure_audit_partition: boolean }>(
        `SELECT ensure_audit_partition((date_trunc('month', now()) + ($1 || ' months')::interval)::date)`,
        [month],
      );

      if (result.rows[0]?.ensure_audit_partition === true) {
        created.push(`+${month}`);
      }
    }

    console.log(
      created.length === 0
        ? `Every month up to +${MONTHS_AHEAD} already has a partition.`
        : `Created partitions for months ${created.join(', ')}.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
