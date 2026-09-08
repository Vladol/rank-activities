import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrationsDir } from './migrations-dir';

/**
 * The migration set as the deploy applies it, read the way Drizzle's own
 * migrator reads it: the journal names the order, each entry names a file, and
 * the SHA-256 of that file is the identity Drizzle records once it is applied.
 *
 * Reading it ourselves rather than asking Drizzle is what lets the startup
 * guard compare an expectation to a fact without running anything (ADR 0003).
 */
export interface Migration {
  readonly idx: number;
  readonly tag: string;
  readonly hash: string;
}

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

export function readMigrations(dir: string = migrationsDir()): readonly Migration[] {
  const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as {
    entries: readonly JournalEntry[];
  };

  return journal.entries.map((entry) => ({
    idx: entry.idx,
    tag: entry.tag,
    hash: createHash('sha256').update(readFileSync(join(dir, `${entry.tag}.sql`), 'utf8')).digest('hex'),
  }));
}

/** The migration the code expects to find applied last. */
export function head(migrations: readonly Migration[] = readMigrations()): Migration {
  const last = migrations.at(-1);

  if (last === undefined) {
    throw new Error('The migration journal is empty; there is no schema for the service to expect.');
  }

  return last;
}
