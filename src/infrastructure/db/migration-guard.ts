import { sql } from 'drizzle-orm';

import type { Database } from './database';
import { type Migration, readMigrations } from './migrations';

/**
 * What the startup check found. Three outcomes rather than a boolean, because
 * "the schema is behind the code" and "the store did not answer" call for
 * different behaviour: the first is a deploy that has not finished and must
 * stop the start, the second is an outage the service is required to degrade
 * through (spec, "An unavailable store degrades named capabilities only").
 */
export type SchemaState =
  | { readonly kind: 'at_head'; readonly head: string }
  | {
      readonly kind: 'mismatch';
      readonly expected: readonly string[];
      readonly found: readonly string[];
      readonly message: string;
    }
  | { readonly kind: 'unreachable'; readonly message: string };

const MIGRATIONS_TABLE = sql`drizzle.__drizzle_migrations`;

/**
 * Reads which migrations the store says are applied and compares them, in
 * order, to the ones the code carries.
 *
 * The comparison is by content hash rather than by count. A migration edited
 * after it was applied has the same name and the same position and describes a
 * schema that is not the one in front of us, which is precisely the case a
 * count cannot see.
 */
export async function inspectSchema(
  db: Database,
  expected: readonly Migration[] = readMigrations(),
): Promise<SchemaState> {
  let applied: readonly string[];

  try {
    const rows = await db.execute<{ hash: string }>(
      sql`SELECT hash FROM ${MIGRATIONS_TABLE} ORDER BY created_at`,
    );

    applied = rows.rows.map((row) => row.hash);
  } catch (cause) {
    // An absent migrations table is not an outage: it is an empty database,
    // which is a schema mismatch like any other and named as one below.
    if (isMissingMigrationsTable(cause)) {
      applied = [];
    } else {
      return { kind: 'unreachable', message: messageOf(cause) };
    }
  }

  const wanted = expected.map((migration) => migration.hash);

  if (wanted.length === applied.length && wanted.every((hash, at) => hash === applied[at])) {
    return { kind: 'at_head', head: expected.at(-1)?.tag ?? '' };
  }

  return {
    kind: 'mismatch',
    expected: expected.map((migration) => migration.tag),
    found: applied,
    message: describe(expected, applied),
  };
}

/**
 * The sentence an operator reads at three in the morning. It names both states
 * because "the schema is wrong" is not actionable and "expected 0006_audit,
 * found 0004_applicability" is (spec, "A schema behind the code stops the
 * start").
 */
function describe(expected: readonly Migration[], applied: readonly string[]): string {
  const divergedAt = expected.findIndex((migration, at) => migration.hash !== applied[at]);
  const head = expected.at(-1)?.tag ?? '(none)';

  if (divergedAt === -1) {
    return (
      `The store has ${applied.length} migrations applied and this build knows ` +
      `${expected.length}, ending at ${head}. The store is ahead of the code: deploy the code, ` +
      'or roll the schema back to what this build expects.'
    );
  }

  const diverged = expected[divergedAt];
  const foundHash = applied[divergedAt];

  return (
    `The schema is not the one this build expects. Expected ${head} as the head, with ` +
    `migration ${divergedAt + 1} being ${diverged?.tag ?? '(none)'} ` +
    `(${diverged?.hash.slice(0, 12) ?? '-'}); the store has ` +
    `${foundHash === undefined ? 'nothing at that position' : foundHash.slice(0, 12)}. ` +
    'Run the migration step of the deploy before starting the service.'
  );
}

function isMissingMigrationsTable(cause: unknown): boolean {
  // 42P01 undefined_table, 3F000 invalid_schema_name: both mean "nothing has
  // ever been migrated here", and neither means the store is down.
  const code = (cause as { code?: unknown } | null)?.code;

  return code === '42P01' || code === '3F000';
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
