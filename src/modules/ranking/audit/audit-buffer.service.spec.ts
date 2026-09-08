import { describe, expect, it, vi } from 'vitest';

import { METRIC, MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { AuditBufferService } from './audit-buffer.service';
import type { AuditWriter } from './audit-writer';
import type { ComputationRunRecord } from './computation-record';
import { deferred } from '../../../../test/support/deferred';

function run(requestId: string): ComputationRunRecord {
  return {
    requestId,
    locationId: '38.72,-9.13' as ComputationRunRecord['locationId'],
    horizonDays: 7,
    profileCode: 'default',
    profileVersion: 1,
    provenance: [],
    outcomes: [],
  };
}

function buffer(writer: AuditWriter | undefined, maxRecords = 1000) {
  const metrics = new MetricsRegistry();
  const service = new AuditBufferService(writer, { flushIntervalMs: 0, maxRecords }, metrics);

  return { service, metrics };
}

describe('recording a computation', () => {
  it('returns before anything is written', () => {
    const outstanding = deferred();
    const writer = { write: vi.fn((_runs: readonly ComputationRunRecord[]) => outstanding.promise) };
    const { service } = buffer(writer);

    // `record` is synchronous by contract: there is no promise for a caller to
    // await even by accident (design.md, Decision 7).
    service.record(run('a'));

    expect(writer.write).not.toHaveBeenCalled();
    expect(service.pending).toBe(1);

    outstanding.resolve();
  });

  it('writes what accumulated in one batch rather than one call per record', async () => {
    const writer = { write: vi.fn((_runs: readonly ComputationRunRecord[]) => Promise.resolve()) };
    const { service } = buffer(writer);

    service.record(run('a'));
    service.record(run('b'));
    service.record(run('c'));

    await service.flush();

    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write.mock.calls[0]?.[0]).toHaveLength(3);
    expect(service.pending).toBe(0);
  });

  it('counts what it writes', async () => {
    const { service, metrics } = buffer({ write: () => Promise.resolve() });

    service.record(run('a'));
    service.record(run('b'));
    await service.flush();

    expect(metrics.read(METRIC.auditRecordsWritten)).toBe(2);
  });
});

describe('a store that will not take the records', () => {
  it('loses them without throwing at anyone', async () => {
    const { service, metrics } = buffer({ write: () => Promise.reject(new Error('no route')) });

    service.record(run('a'));
    service.record(run('b'));

    await expect(service.flush()).resolves.toBeUndefined();
    expect(metrics.read(METRIC.auditRecordsLost)).toBe(2);
  });

  it('keeps taking records afterwards rather than jamming', async () => {
    const { service } = buffer({ write: () => Promise.reject(new Error('no route')) });

    service.record(run('a'));
    await service.flush();
    service.record(run('b'));

    expect(service.pending).toBe(1);
  });
});

describe('the bound on what is held', () => {
  it('drops the oldest past the limit and counts the loss', () => {
    const { service, metrics } = buffer({ write: () => Promise.resolve() }, 2);

    service.record(run('a'));
    service.record(run('b'));
    service.record(run('c'));

    expect(service.pending).toBe(2);
    expect(metrics.read(METRIC.auditRecordsLost)).toBe(1);
  });

  it('counts what a shutdown could not flush', async () => {
    const { service, metrics } = buffer({ write: () => Promise.reject(new Error('gone')) });

    service.record(run('a'));
    await service.onApplicationShutdown();

    expect(metrics.read(METRIC.auditRecordsLost)).toBe(1);
  });
});

describe('a build with no store', () => {
  it('takes records and keeps none, without counting a loss', async () => {
    const { service, metrics } = buffer(undefined);

    service.record(run('a'));
    await service.flush();

    // Nothing was ever going to be kept, and a build with no store says so at
    // startup. Counting it as loss would make the metric meaningless.
    expect(service.pending).toBe(0);
    expect(metrics.read(METRIC.auditRecordsLost)).toBe(0);
  });
});
