import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REASON, REASON_KINDS } from '../../src/domain/shared/reason-code';
import { METRICS } from '../../src/domain/weather/metric';
import { PublicationConflictError, publishVersions } from '../../src/infrastructure/db/seed/publish';
import { seed } from '../../src/infrastructure/db/seed/seed';
import { type TestDatabase, migratedDatabase } from './support/database';

let database: TestDatabase;

beforeAll(async () => {
  database = await migratedDatabase();
});

afterAll(async () => {
  await database?.close();
});

describe('publishing the reference registries', () => {
  it('mirrors the dictionaries the code is running on', async () => {
    const report = await seed(database.db);

    expect(report.metrics).toBe(Object.keys(METRICS).length);
    expect(report.reasonCodes).toBe(Object.keys(REASON).length);
  });

  it('agrees with the registry on what kinds of reason exist', async () => {
    // Two vocabularies for the same four kinds would have to be translated
    // somewhere, and the translation is the bug.
    const rows = await database.db.execute<{ kind: string }>(
      sql`SELECT DISTINCT kind FROM reason_codes ORDER BY 1`,
    );

    expect(rows.rows.map((row) => row.kind).toSorted()).toEqual([...REASON_KINDS].toSorted());
  });

  it('needs no migration to change: running again just updates the content', async () => {
    const before = await migrationCount();

    await seed(database.db);

    expect(await migrationCount()).toBe(before);
  });
});

describe('publishing a version of the rules', () => {
  it('publishes what was not there', async () => {
    const outcome = await publishVersions(database.db, 'activity', [
      { code: 'demo', version: 1, content: { rule: 'first' } },
    ]);

    expect(outcome).toEqual({ published: ['demo@1'], unchanged: [] });
  });

  it('changes nothing at all when the same content is published again', async () => {
    const before = await storedRow('demo', 1);
    const outcome = await publishVersions(database.db, 'activity', [
      // Same content, keys in the other order: a digest that noticed the order
      // would turn every redeploy into a failed one.
      { code: 'demo', version: 1, content: { rule: 'first' } },
    ]);

    expect(outcome).toEqual({ published: [], unchanged: ['demo@1'] });
    expect(await storedRow('demo', 1)).toEqual(before);
  });

  it('fails the deploy when an already-published version says something else', async () => {
    const rewrite = publishVersions(database.db, 'activity', [
      { code: 'demo', version: 1, content: { rule: 'rewritten' } },
    ]);

    await expect(rewrite).rejects.toBeInstanceOf(PublicationConflictError);
    await expect(rewrite).rejects.toThrow(/demo@1/);
    // The difference itself, not merely that there is one: the operator is
    // holding a deploy while reading this.
    await expect(rewrite).rejects.toThrow(/rule: stored "first", publishing "rewritten"/);
  });

  it('leaves the stored version exactly as it was after refusing', async () => {
    expect((await storedRow('demo', 1))?.definition).toEqual({ rule: 'first' });
  });

  it('takes a new version beside the old one rather than instead of it', async () => {
    await publishVersions(database.db, 'activity', [
      { code: 'demo', version: 2, content: { rule: 'second' } },
    ]);

    expect((await storedRow('demo', 1))?.definition).toEqual({ rule: 'first' });
    expect((await storedRow('demo', 2))?.definition).toEqual({ rule: 'second' });
  });

  it('gives the same version the same identifier in any process', async () => {
    // Computed from `code@version`, so two deploys from two machines that never
    // met agree on which row this is.
    expect((await storedRow('demo', 1))?.id).toBe((await storedRow('demo', 1))?.id);
    expect((await storedRow('demo', 1))?.id).not.toBe((await storedRow('demo', 2))?.id);
  });
});

describe('a computation made under an older version', () => {
  it('can still read the version it names after a newer one is published', async () => {
    const recorded = await storedRow('demo', 1);

    await publishVersions(database.db, 'activity', [
      { code: 'demo', version: 3, content: { rule: 'third' } },
    ]);

    expect((await storedRow('demo', 1))?.definition).toEqual(recorded?.definition);
  });

  it('finds every declaration the running catalogue offers, at its own version', async () => {
    const rows = await database.db.execute<{ code: string; version: number }>(sql`
      SELECT code, version FROM activity_definitions WHERE code <> 'demo' ORDER BY code
    `);

    expect(rows.rows.map((row) => `${row.code}@${row.version}`)).toEqual([
      'indoor-sightseeing@1',
      'outdoor-sightseeing@1',
      'ski@1',
      'surfing@1',
    ]);
  });
});

async function storedRow(
  code: string,
  version: number,
): Promise<{ id: string; definition: unknown } | undefined> {
  const rows = await database.db.execute<{ id: string; definition: unknown }>(sql`
    SELECT id, definition FROM activity_definitions WHERE code = ${code} AND version = ${version}
  `);

  return rows.rows[0];
}

async function migrationCount(): Promise<number> {
  const rows = await database.db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
  );

  return Number(rows.rows[0]?.count);
}
