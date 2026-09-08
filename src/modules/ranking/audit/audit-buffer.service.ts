import { Inject, Injectable, Logger, type OnApplicationShutdown, Optional } from '@nestjs/common';

import { METRIC, METRICS, type MetricsRegistry } from '../../../common/metrics/metrics.registry';
import type { AuditPort } from './audit.port';
import type { AuditWriter } from './audit-writer';
import type { ComputationRunRecord } from './computation-record';

export interface AuditBufferOptions {
  /** How long a record may wait in memory before a flush is attempted. */
  readonly flushIntervalMs: number;
  /**
   * The most records held at once. Past it the oldest are dropped and counted:
   * a buffer that grows without a bound turns a store outage into an
   * out-of-memory kill, which costs the answers the buffer exists to protect.
   */
  readonly maxRecords: number;
}

export const AUDIT_OPTIONS: unique symbol = Symbol('AuditBufferOptions');

export const AUDIT_WRITER: unique symbol = Symbol('AuditWriter');

/**
 * The audit buffer: records in, a periodic flush out, and a count of what was
 * lost.
 *
 * Losing records is a property of the design rather than a defect of it. Writing
 * synchronously would add a round trip to every answer and make the database an
 * availability dependency of ranking, which is the dependency ADR 0007 and
 * Decision 2 spent their effort removing. What audit is for — calibrating
 * weights and reviewing an incident — needs a representative sample, not a
 * guaranteed one (design.md, Decision 7).
 */
@Injectable()
export class AuditBufferService implements AuditPort, OnApplicationShutdown {
  private readonly logger = new Logger(AuditBufferService.name);

  private buffer: ComputationRunRecord[] = [];

  private timer: ReturnType<typeof setInterval> | undefined;

  private flushing: Promise<void> | undefined;

  constructor(
    @Inject(AUDIT_WRITER) private readonly writer: AuditWriter | undefined,
    @Inject(AUDIT_OPTIONS) private readonly options: AuditBufferOptions,
    @Optional() @Inject(METRICS) private readonly metrics?: MetricsRegistry,
  ) {
    if (this.writer !== undefined && this.options.flushIntervalMs > 0) {
      this.timer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
      // The flush must never be the reason a process stays alive.
      this.timer.unref?.();
    }
  }

  record(run: ComputationRunRecord): void {
    if (this.writer === undefined) {
      // Nowhere to write. Not a loss to count: nothing was ever going to be
      // kept, and a build with no store says so at startup.
      return;
    }

    if (this.buffer.length >= this.options.maxRecords) {
      // The oldest goes, because the newest is the one an incident is about.
      this.buffer.shift();
      this.lost(1);
    }

    this.buffer.push(run);
  }

  /** How many records are waiting. Read by the tests and by the log line. */
  get pending(): number {
    return this.buffer.length;
  }

  /**
   * Writes what has accumulated. Never throws: a failed flush costs the records
   * it was holding and a metric, and the caller of `record` is long gone.
   */
  async flush(): Promise<void> {
    if (this.flushing !== undefined) {
      return this.flushing;
    }

    if (this.writer === undefined || this.buffer.length === 0) {
      return;
    }

    const batch = this.buffer;

    // Taken before the write, so records arriving during it are not written
    // twice and are not lost when this batch fails.
    this.buffer = [];
    this.flushing = this.writer
      .write(batch)
      .then(() => {
        this.metrics?.increment(METRIC.auditRecordsWritten, {}, batch.length);
      })
      .catch((cause: unknown) => {
        this.lost(batch.length);
        this.logger.warn(
          `Lost ${batch.length} audit records: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      })
      .finally(() => {
        this.flushing = undefined;
      });

    return this.flushing;
  }

  /**
   * A last flush on the way down. It is best-effort by nature: a process being
   * killed does not wait, and that is the loss the metric exists to measure.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    await this.flush();

    if (this.buffer.length > 0) {
      this.lost(this.buffer.length);
      this.buffer = [];
    }
  }

  private lost(records: number): void {
    this.metrics?.increment(METRIC.auditRecordsLost, {}, records);
  }
}
