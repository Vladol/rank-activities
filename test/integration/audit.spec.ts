import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MetricsRegistry, METRIC } from '../../src/common/metrics/metrics.registry';
import { AuditBufferService } from '../../src/modules/ranking/audit/audit-buffer.service';
import { DbAuditWriter } from '../../src/modules/ranking/audit/audit-writer';
import type { ComputationRunRecord } from '../../src/modules/ranking/audit/computation-record';
import { recordOf } from '../../src/modules/ranking/audit/computation-record';
import { DbLocationStore } from '../../src/modules/geo/adapters/db-location.store';
import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';
import { seed } from '../../src/infrastructure/db/seed/seed';
import { rankingHarness } from '../support/ranking';
import { type TestDatabase, migratedDatabase } from './support/database';

const LISBON = { kind: 'coordinates', coordinates: { latitude: 38.7167, longitude: -9.1333 } } as const;
const catalogue = SeedActivityCatalogue.load();

let database: TestDatabase;
let record: ComputationRunRecord;

beforeAll(async () => {
  database = await migratedDatabase();
  await seed(database.db);

  // A real answer, recorded the way the service records one. Everything below
  // is about what the store then holds.
  const harness = rankingHarness();
  const answered = await harness.service.rank({ location: LISBON });

  if (!answered.ok) {
    throw new Error('the harness could not produce an answer to audit');
  }

  // The run refers to the place, so the place has to be there.
  await new DbLocationStore(database.db).save(answered.value.location);

  record = recordOf('2c9e1f60-0000-4000-8000-000000000001', answered.value, (code) =>
    catalogue.find(code)?.version ?? 0,
  );

  await new DbAuditWriter(database.db).write([record]);
});

afterAll(async () => {
  await database?.close();
});

describe('a recorded computation', () => {
  it('is one run and one row per activity per local day', async () => {
    expect(await count('computation_runs')).toBe(1);
    expect(await count('computation_audit')).toBe(record.outcomes.length);
    expect(record.outcomes.length).toBe(28);
  });

  it('carries the provenance once, on the run, and not on twenty-eight rows', async () => {
    const rows = await database.db.execute<{ provenance: unknown }>(
      sql`SELECT provenance FROM computation_runs`,
    );

    expect(Array.isArray(rows.rows[0]?.provenance)).toBe(true);
  });

  it('lands in the partition for the month it was created in', async () => {
    const rows = await database.db.execute<{ partition: string }>(sql`
      SELECT DISTINCT tableoid::regclass::text AS partition FROM computation_audit
    `);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.partition).toMatch(/^computation_audit_\d{4}_\d{2}$/);
  });

  it('holds aggregates in `inputs`, never the series they came from', async () => {
    const rows = await database.db.execute<{ inputs: unknown }>(sql`
      SELECT inputs FROM computation_audit WHERE outcome = 'ranked' LIMIT 1
    `);
    const inputs = rows.rows[0]?.inputs as readonly Record<string, unknown>[];

    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0]).toHaveProperty('featureId');
    expect(inputs[0]).toHaveProperty('normalized');
    expect(JSON.stringify(inputs)).not.toMatch(/"times"|"hourly"|"daily"/);
  });

  it('stays small enough that the estimate in data-model.md section 8 holds', async () => {
    const rows = await database.db.execute<{ bytes: string }>(sql`
      SELECT avg(pg_column_size(computation_audit.*))::bigint::text AS bytes FROM computation_audit
    `);

    // ~700 bytes a row was the budget; storing a series would be ~25 KB.
    expect(Number(rows.rows[0]?.bytes)).toBeLessThan(2000);
  });

  it('names every reason from the registry, which is why the foreign key holds', async () => {
    const rows = await database.db.execute<{ reason: string }>(sql`
      SELECT DISTINCT a.reason FROM computation_audit a WHERE a.reason IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM reason_codes r WHERE r.code = a.reason)
    `);

    expect(rows.rows).toEqual([]);
  });
});

describe('flushing into a store that is there and one that is not', () => {
  it('writes the batch and counts it', async () => {
    const metrics = new MetricsRegistry();
    const buffer = new AuditBufferService(
      new DbAuditWriter(database.db),
      { flushIntervalMs: 0, maxRecords: 100 },
      metrics,
    );

    buffer.record({ ...record, requestId: '2c9e1f60-0000-4000-8000-000000000002' });
    await buffer.flush();

    expect(metrics.read(METRIC.auditRecordsWritten)).toBe(1);
    expect(await count('computation_runs')).toBe(2);
  });

  it('loses the batch and counts it when the store has gone away', async () => {
    const gone = await migratedDatabase();

    await gone.close();

    const metrics = new MetricsRegistry();
    const buffer = new AuditBufferService(
      new DbAuditWriter(gone.db),
      { flushIntervalMs: 0, maxRecords: 100 },
      metrics,
    );

    buffer.record(record);

    await expect(buffer.flush()).resolves.toBeUndefined();
    expect(metrics.read(METRIC.auditRecordsLost)).toBe(1);
  });
});

async function count(table: string): Promise<number> {
  const rows = await database.db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM ${sql.identifier(table)}`,
  );

  return Number(rows.rows[0]?.count);
}
