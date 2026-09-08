import type { Database } from '../../../infrastructure/db/database';
import { computationAudit, computationRuns } from '../../../infrastructure/db/schema/audit';
import { locationRowId } from '../../geo/adapters/db-location.store';
import type { ComputationRunRecord } from './computation-record';

/** What actually puts records in the store, separated so the buffer is testable. */
export interface AuditWriter {
  write(runs: readonly ComputationRunRecord[]): Promise<void>;
}

/**
 * The writer over PostgreSQL. One transaction per flush rather than per record:
 * the whole point of buffering is to pay for the round trip once.
 */
export class DbAuditWriter implements AuditWriter {
  constructor(private readonly db: Database) {}

  async write(runs: readonly ComputationRunRecord[]): Promise<void> {
    if (runs.length === 0) {
      return;
    }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(computationRuns)
        .values(
          runs.map((run) => ({
            requestId: run.requestId,
            locationId: locationRowId(run.locationId),
            horizonDays: run.horizonDays,
            profileCode: run.profileCode,
            profileVersion: run.profileVersion,
            provenance: run.provenance,
            createdAt: new Date(),
          })),
        )
        // A request id that is already recorded is a flush that was retried,
        // not a second computation.
        .onConflictDoNothing({ target: computationRuns.requestId });

      const outcomes = runs.flatMap((run) =>
        run.outcomes.map((outcome) => ({
          requestId: run.requestId,
          localDate: outcome.localDate,
          activityCode: outcome.activityCode,
          activityVersion: outcome.activityVersion,
          outcome: outcome.outcome,
          score: outcome.score,
          reason: outcome.reason,
          inputs: outcome.inputs,
          createdAt: new Date(),
        })),
      );

      if (outcomes.length > 0) {
        await tx.insert(computationAudit).values(outcomes);
      }
    });
  }
}
