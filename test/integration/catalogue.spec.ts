import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeCatalogueContract } from '../../src/modules/activities/contract/activity-catalogue.conformance';
import { StoreActivityCatalogue } from '../../src/modules/activities/adapters/store-catalogue';
import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';
import { publishVersions } from '../../src/infrastructure/db/seed/publish';
import { seed } from '../../src/infrastructure/db/seed/seed';
import { type TestDatabase, migratedDatabase } from './support/database';

const databases: TestDatabase[] = [];

afterAll(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

/**
 * The same suite the file-backed catalogue runs, against the store-backed one,
 * unchanged. That it is imported rather than copied is the assertion: the path
 * a developer runs and the path production runs are checked by one contract
 * (design.md, Decision 8).
 */
describeCatalogueContract('store-backed', async (declarations, sharedRules) => {
  const database = await migratedDatabase();

  databases.push(database);

  await publishVersions(
    database.db,
    'activity',
    declarations.map((declaration) => {
      const authored = declaration as { code: string; version: number };

      return {
        code: authored.code,
        version: authored.version,
        content: { declaration, sharedRules },
      };
    }),
  );

  return StoreActivityCatalogue.load(database.db);
});

describe('the store-backed catalogue against the published seeds', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await migratedDatabase();
    databases.push(database);
    await seed(database.db);
  });

  it('resolves every published declaration to what the file adapter resolves it to', async () => {
    const fromStore = await StoreActivityCatalogue.load(database.db);
    const fromFiles = SeedActivityCatalogue.load();

    // Field for field, including the fingerprint: two storages, one answer.
    expect(fromStore.activities()).toEqual(fromFiles.activities());
  });

  it('picks up a newly published version without a restart', async () => {
    const catalogue = await StoreActivityCatalogue.load(database.db, { lifetimeMs: 0 });

    expect(catalogue.find('ski')?.version).toBe(1);

    const ski = await storedDeclaration('ski', 1);

    await publishVersions(database.db, 'activity', [
      {
        code: 'ski',
        version: 2,
        content: { ...ski, declaration: { ...(ski.declaration as object), version: 2 } },
      },
    ]);

    expect(await catalogue.refresh()).toBe(true);
    expect(catalogue.find('ski')?.version).toBe(2);
    // And the version a past computation names is still there beside it.
    expect(catalogue.findVersion('ski', 1)?.version).toBe(1);
  });

  it('does not reload when nothing has been published since the last check', async () => {
    const catalogue = await StoreActivityCatalogue.load(database.db, { lifetimeMs: 0 });

    expect(await catalogue.refresh()).toBe(false);
  });

  it('refuses to hand out a published row that no longer loads', async () => {
    // What a rollback or an edit in psql leaves behind. It must stop at the
    // adapter rather than reach the engine as a NaN.
    //
    // In a store of its own, because the row cannot be cleaned up afterwards:
    // a published version is immutable, and the trigger that says so does not
    // make an exception for the test that wrote it.
    const spoiled = await migratedDatabase();

    databases.push(spoiled);

    await spoiled.db.execute(sql`
      INSERT INTO activity_definitions (id, code, version, definition, checksum, effective_from)
      VALUES (gen_random_uuid(), 'broken', 1,
              '{"declaration":{"code":"broken","version":1,"titleKey":"x","features":[]},"sharedRules":{"version":1,"rules":{}}}'::jsonb,
              'x', now())
    `);

    await expect(StoreActivityCatalogue.load(spoiled.db)).rejects.toThrow(/broken@1 is invalid/);
  });

  async function storedDeclaration(code: string, version: number): Promise<Record<string, unknown>> {
    const rows = await database.db.execute<{ definition: Record<string, unknown> }>(
      sql`SELECT definition FROM activity_definitions WHERE code = ${code} AND version = ${version}`,
    );

    return rows.rows[0]?.definition ?? {};
  }
});
