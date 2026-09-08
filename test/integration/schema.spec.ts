import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readMigrations } from '../../src/infrastructure/db/migrations';
import { type TestDatabase, emptyDatabase, migratedDatabase, refusalOf } from './support/database';
import { applyMigrations } from '../../src/infrastructure/db/migrate';

let database: TestDatabase;

beforeAll(async () => {
  database = await migratedDatabase();
});

afterAll(async () => {
  await database?.close();
});

/**
 * The shape the six migrations of data-model.md, section 9 are expected to
 * leave behind. Written out rather than derived from the Drizzle schema: a
 * comparison of the migrations against the thing the migrations produced would
 * agree with itself whatever either one said.
 */
const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  metrics: ['canonical_unit', 'capability', 'code', 'granularity', 'kind', 'plausible_max', 'plausible_min'],
  reason_codes: ['code', 'kind'],
  activity_definitions: ['checksum', 'code', 'created_at', 'definition', 'effective_from', 'id', 'version'],
  scoring_profiles: ['checksum', 'code', 'created_at', 'effective_from', 'id', 'version', 'weights'],
  locations: [
    'admin1', 'country', 'elevation_m', 'geocoded_at', 'grid_key', 'id', 'lat', 'lon',
    'name', 'population', 'provider_place_id', 'timezone',
  ],
  location_profiles: [
    'computed_at', 'evidence', 'location_id', 'rules_version', 'snow_season', 'snow_season_source',
  ],
  marine_probes: ['all_null', 'local_date', 'location_id', 'probed_at'],
  geocoding_cache: ['expires_at', 'fetched_at', 'found', 'query_normalized', 'result'],
  computation_runs: [
    'created_at', 'horizon_days', 'location_id', 'profile_code', 'profile_version',
    'provenance', 'request_id',
  ],
  computation_audit: [
    'activity_code', 'activity_version', 'created_at', 'id', 'inputs', 'local_date',
    'outcome', 'reason', 'request_id', 'score',
  ],
};

describe('applying the migration set to an empty database', () => {
  it('creates exactly the tables the schema describes, and no others', async () => {
    const rows = await database.db.execute<{ table_name: string }>(sql`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relispartition = false
      ORDER BY 1
    `);

    expect(rows.rows.map((row) => row.table_name)).toEqual(Object.keys(EXPECTED_COLUMNS).toSorted());
  });

  it.each(Object.entries(EXPECTED_COLUMNS))('gives %s the columns it declares', async (table, columns) => {
    const rows = await database.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY 1
    `);

    expect(rows.rows.map((row) => row.column_name)).toEqual([...columns]);
  });

  it('records every migration of the journal, in order', async () => {
    const rows = await database.db.execute<{ hash: string }>(
      sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`,
    );

    expect(rows.rows.map((row) => row.hash)).toEqual(readMigrations().map((one) => one.hash));
  });

  it('partitions the audit by range over its creation time', async () => {
    const rows = await database.db.execute<{ strategy: string; partitions: number }>(sql`
      SELECT p.partstrat AS strategy,
             (SELECT count(*) FROM pg_inherits WHERE inhparent = 'computation_audit'::regclass) AS partitions
      FROM pg_partitioned_table p
      WHERE p.partrelid = 'computation_audit'::regclass
    `);

    expect(rows.rows[0]?.strategy).toBe('r');
    // The month before, a year ahead, and the default that catches whatever
    // provisioning missed: fourteen months plus one.
    expect(Number(rows.rows[0]?.partitions)).toBe(15);
  });

  it('provisions a further month idempotently', async () => {
    const create = async (): Promise<boolean> =>
      (
        await database.db.execute<{ ensure_audit_partition: boolean }>(
          sql`SELECT ensure_audit_partition((date_trunc('month', now()) + interval '13 months')::date)`,
        )
      ).rows[0]?.ensure_audit_partition ?? false;

    expect(await create()).toBe(true);
    expect(await create()).toBe(false);
  });

  it('refuses a month whose rows have already fallen into the default partition', async () => {
    // The one failure mode a monthly-partitioned table has, said in a sentence
    // rather than as PostgreSQL's own constraint error.
    await database.db.execute(sql`
      INSERT INTO locations (id, grid_key, name, lat, lon, timezone, geocoded_at)
      VALUES ('00000000-0000-5000-8000-00000000000f'::uuid, '1.00,1.00', 'late', 1, 1, 'UTC', now())
    `);
    await database.db.execute(sql`
      INSERT INTO computation_runs (request_id, location_id, horizon_days, profile_code, profile_version, provenance, created_at)
      VALUES ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-5000-8000-00000000000f'::uuid,
              7, 'default', 1, '[]'::jsonb, now() + interval '20 months')
    `);
    await database.db.execute(sql`
      INSERT INTO computation_audit (request_id, local_date, activity_code, activity_version, outcome, score, inputs, created_at)
      VALUES ('00000000-0000-4000-8000-00000000000f'::uuid, current_date, 'ski', 1, 'ranked', 50, '[]'::jsonb,
              now() + interval '20 months')
    `);

    const refused = await refusalOf(
      database.db.execute(
        sql`SELECT ensure_audit_partition((date_trunc('month', now()) + interval '20 months')::date)`,
      ),
    );

    expect(refused.message).toMatch(/already in the default partition/);
  });

  it('is a no-op when the deploy step runs a second time', async () => {
    await applyMigrations(database.db);

    const rows = await database.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );

    expect(Number(rows.rows[0]?.count)).toBe(readMigrations().length);
  });
});

describe('the indexes', () => {
  /**
   * Task 1.8 of this change, kept as an assertion rather than a habit: an index
   * costs a write on every insert, so one that no query needs is a permanent
   * charge for nothing. The comment is where the query it serves is named.
   */
  it('names the query each one serves, primary keys excepted', async () => {
    const rows = await database.db.execute<{ indexname: string; description: string | null }>(sql`
      SELECT i.relname AS indexname, obj_description(i.oid, 'pg_class') AS description
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND x.indisprimary = false AND i.relispartition = false
      ORDER BY 1
    `);

    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.filter((row) => row.description === null)).toEqual([]);
  });
});

describe('a database nothing has been applied to', () => {
  it('holds no table of ours at all', async () => {
    const empty = await emptyDatabase();

    try {
      const rows = await empty.db.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'
      `);

      expect(Number(rows.rows[0]?.count)).toBe(0);
    } finally {
      await empty.close();
    }
  });
});
