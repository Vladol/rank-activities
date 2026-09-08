import type { ComputationRunRecord } from './computation-record';

/**
 * Where a computation record goes.
 *
 * `record` returns nothing and is not awaited by the caller: the answer must not
 * wait for a write, and an audit that cannot be written costs records and a
 * metric rather than latency (design.md, Decision 7).
 */
export interface AuditPort {
  record(run: ComputationRunRecord): void;
}

export const AUDIT_PORT: unique symbol = Symbol('AuditPort');
