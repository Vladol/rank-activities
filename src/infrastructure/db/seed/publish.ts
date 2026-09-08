import { and, eq } from 'drizzle-orm';

import type { Database } from '../database';
import { activityDefinitions, scoringProfiles } from '../schema/rules';
import { NAMESPACE, uuidv5 } from '../uuid5';
import { checksumOf, differencesBetween } from './checksum';

/** One thing to publish: what it is called, which version, and what it says. */
export interface PublishableVersion {
  readonly code: string;
  readonly version: number;
  readonly content: Record<string, unknown>;
}

export interface PublicationOutcome {
  /** Versions that were not there and now are, as `code@version`. */
  readonly published: readonly string[];
  /** Versions that were already there, byte for byte. Publishing left them alone. */
  readonly unchanged: readonly string[];
}

/**
 * A version that already exists and says something else.
 *
 * It fails the deploy rather than overwriting, because every audit record that
 * names this version claims the content behind it explains a past score. A
 * silent rewrite makes that claim false for every one of them, retroactively
 * and invisibly (ADR 0003).
 */
export class PublicationConflictError extends Error {
  constructor(
    readonly code: string,
    readonly version: number,
    readonly differences: readonly string[],
  ) {
    super(
      `${code}@${version} is already published and says something different. A published version ` +
        `is immutable: raise the version instead of editing this one. What differs:\n` +
        differences.map((difference) => `  ${difference}`).join('\n'),
    );
    this.name = 'PublicationConflictError';
  }
}

const TABLES = {
  activity: { table: activityDefinitions, column: 'definition' },
  profile: { table: scoringProfiles, column: 'weights' },
} as const;

export type PublishableKind = keyof typeof TABLES;

/**
 * Publishes versions idempotently by `(code, version)`.
 *
 * Three outcomes and no fourth: absent becomes published, identical is left
 * exactly as it was, and different is a failure that names what differs. The
 * comparison is on content rather than on the stored checksum alone, so a row
 * whose checksum was tampered with is still caught by its content.
 */
export async function publishVersions(
  db: Database,
  kind: PublishableKind,
  versions: readonly PublishableVersion[],
): Promise<PublicationOutcome> {
  const { table, column } = TABLES[kind];
  const published: string[] = [];
  const unchanged: string[] = [];

  for (const version of versions) {
    const name = `${version.code}@${version.version}`;
    const [stored] = await db
      .select()
      .from(table)
      .where(and(eq(table.code, version.code), eq(table.version, version.version)))
      .limit(1);

    if (stored === undefined) {
      await db.insert(table).values({
        id: uuidv5(name, NAMESPACE.rules),
        code: version.code,
        version: version.version,
        [column]: version.content,
        checksum: checksumOf(version.content),
        effectiveFrom: new Date(),
        createdAt: new Date(),
      } as typeof table.$inferInsert);

      published.push(name);
      continue;
    }

    const differences = differencesBetween(
      (stored as Record<string, unknown>)[column],
      version.content,
    );

    if (differences.length > 0) {
      throw new PublicationConflictError(version.code, version.version, differences);
    }

    unchanged.push(name);
  }

  return { published, unchanged };
}
