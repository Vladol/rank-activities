import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from '../../src/infrastructure/db/pg-error';
import { type TestDatabase, migratedDatabase, refusalOf } from './support/database';

let database: TestDatabase;

const LOCATION = '3c5a1f8e-0000-5000-8000-000000000001';

beforeAll(async () => {
  database = await migratedDatabase();

  await database.db.execute(sql`
    INSERT INTO reason_codes (code, kind) VALUES ('NO_COASTLINE_NEARBY', 'not_applicable')
  `);
  await database.db.execute(sql`
    INSERT INTO locations (id, grid_key, name, lat, lon, timezone, geocoded_at)
    VALUES (${LOCATION}::uuid, '38.72,-9.14', 'Lisbon', 38.72, -9.14, 'Europe/Lisbon', now())
  `);
});

afterAll(async () => {
  await database?.close();
});

/**
 * Every case here is written against the store directly rather than through a
 * service, because that is the claim: the invariant holds whoever is writing —
 * the application, a migration, or a developer in psql. A check that only the
 * service performs is a check a concurrent request can walk past
 * (data-model.md, section 2.7).
 */
describe('a published version of the rules', () => {
  const published = async (version: number): Promise<void> => {
    await database.db.execute(sql`
      INSERT INTO activity_definitions (id, code, version, definition, checksum, effective_from)
      VALUES (${randomUUID()}::uuid, 'ski', ${version}, '{"code":"ski"}'::jsonb, 'abc', now())
    `);
  };

  it('cannot be published twice under the same version', async () => {
    await published(1);

    expect((await refusalOf(published(1))).code).toBe(UNIQUE_VIOLATION);
  });

  it('is refused an update by the store, not by the service', async () => {
    await published(2);

    const refused = await refusalOf(
      database.db.execute(sql`
        UPDATE activity_definitions SET definition = '{"code":"ski","changed":true}'::jsonb
        WHERE code = 'ski' AND version = 2
      `),
    );

    expect(refused.message).toMatch(/ski@2 is immutable/);
  });

  it('is refused a deletion for the same reason', async () => {
    await published(3);

    const refused = await refusalOf(
      database.db.execute(sql`DELETE FROM activity_definitions WHERE code = 'ski' AND version = 3`),
    );

    expect(refused.message).toMatch(/immutable/);
  });

  it('still reads back what it said after a newer version is published', async () => {
    const stored = await database.db.execute<{ definition: unknown }>(sql`
      SELECT definition FROM activity_definitions WHERE code = 'ski' AND version = 1
    `);

    expect(stored.rows[0]?.definition).toEqual({ code: 'ski' });
  });
});

describe('the probe record', () => {
  const probe = async (date: string): Promise<void> => {
    await database.db.execute(sql`
      INSERT INTO marine_probes (location_id, local_date, all_null, probed_at)
      VALUES (${LOCATION}::uuid, ${date}::date, true, now())
    `);
  };

  it('makes a second probe on the same local date impossible', async () => {
    await probe('2026-09-07');

    expect((await refusalOf(probe('2026-09-07'))).code).toBe(UNIQUE_VIOLATION);
  });

  it('is two rows on two dates, which is what the two-phase confirmation is', async () => {
    await probe('2026-09-08');

    const rows = await database.db.execute<{ local_date: string }>(sql`
      SELECT local_date::text FROM marine_probes WHERE location_id = ${LOCATION}::uuid ORDER BY 1
    `);

    expect(rows.rows.map((row) => row.local_date)).toEqual(['2026-09-07', '2026-09-08']);
  });
});

describe('an undecided conclusion', () => {
  it('is stored as absent rather than as a negative one', async () => {
    await database.db.execute(sql`
      INSERT INTO location_profiles (location_id, evidence, rules_version, computed_at)
      VALUES (${LOCATION}::uuid, '{}'::jsonb, 1, now())
    `);

    const rows = await database.db.execute<{ snow_season: boolean | null }>(sql`
      SELECT snow_season FROM location_profiles WHERE location_id = ${LOCATION}::uuid
    `);

    expect(rows.rows[0]?.snow_season).toBeNull();
  });

  it('cannot claim a basis it has no conclusion for', async () => {
    const refused = await refusalOf(
      database.db.execute(sql`
        UPDATE location_profiles SET snow_season_source = 'archive'
        WHERE location_id = ${LOCATION}::uuid
      `),
    );

    expect(refused.code).toBe(CHECK_VIOLATION);
  });

  it('cannot conclude without saying on what basis', async () => {
    const refused = await refusalOf(
      database.db.execute(sql`
        UPDATE location_profiles SET snow_season = false WHERE location_id = ${LOCATION}::uuid
      `),
    );

    expect(refused.code).toBe(CHECK_VIOLATION);
  });
});

describe('a place lookup', () => {
  it('cannot claim a result was found while carrying none', async () => {
    const refused = await refusalOf(
      database.db.execute(sql`
        INSERT INTO geocoding_cache (query_normalized, found, result, fetched_at, expires_at)
        VALUES ('lisbon', true, NULL, now(), now() + interval '30 days')
      `),
    );

    expect(refused.code).toBe(CHECK_VIOLATION);
  });

  it('cannot carry a result while claiming nothing was found', async () => {
    const refused = await refusalOf(
      database.db.execute(sql`
        INSERT INTO geocoding_cache (query_normalized, found, result, fetched_at, expires_at)
        VALUES ('lisbon', false, '[]'::jsonb, now(), now() + interval '30 days')
      `),
    );

    expect(refused.code).toBe(CHECK_VIOLATION);
  });

  it('records a miss as a row with no result, which is what stops the next call', async () => {
    await database.db.execute(sql`
      INSERT INTO geocoding_cache (query_normalized, found, result, fetched_at, expires_at)
      VALUES ('qwertyuiop', false, NULL, now(), now() + interval '5 minutes')
    `);

    const rows = await database.db.execute<{ found: boolean }>(
      sql`SELECT found FROM geocoding_cache WHERE query_normalized = 'qwertyuiop'`,
    );

    expect(rows.rows[0]?.found).toBe(false);
  });
});

describe('an audit row', () => {
  const RUN = 'a1b2c3d4-0000-4000-8000-000000000001';

  beforeAll(async () => {
    await database.db.execute(sql`
      INSERT INTO computation_runs (request_id, location_id, horizon_days, profile_code, profile_version, provenance)
      VALUES (${RUN}::uuid, ${LOCATION}::uuid, 7, 'default', 1, '[]'::jsonb)
    `);
  });

  const audit = (outcome: string, score: string, reason: string): Promise<unknown> =>
    database.db.execute(sql`
      INSERT INTO computation_audit (request_id, local_date, activity_code, activity_version, outcome, score, reason, inputs)
      VALUES (${RUN}::uuid, '2026-09-08'::date, 'ski', 1, ${outcome}, ${sql.raw(score)}, ${sql.raw(reason)}, '[]'::jsonb)
    `);

  it('takes a score when the outcome is a ranked one', async () => {
    await expect(audit('ranked', '72', 'NULL')).resolves.toBeDefined();
  });

  it('is refused a ranked outcome with no score', async () => {
    expect((await refusalOf(audit('ranked', 'NULL', 'NULL'))).code).toBe(CHECK_VIOLATION);
  });

  it('is refused a score on an outcome that was not ranked', async () => {
    expect((await refusalOf(audit('not_applicable', '0', "'NO_COASTLINE_NEARBY'"))).code).toBe(
      CHECK_VIOLATION,
    );
  });

  it('is refused a reason that is not a registered code', async () => {
    expect((await refusalOf(audit('no_data', 'NULL', "'INVENTED_REASON'"))).code).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('lands in the partition its creation time falls in', async () => {
    const rows = await database.db.execute<{ partition: string }>(sql`
      SELECT tableoid::regclass::text AS partition FROM computation_audit LIMIT 1
    `);

    expect(rows.rows[0]?.partition).toMatch(/^computation_audit_\d{4}_\d{2}$/);
  });
});
