import type { ResolvedDefinition } from '../../../domain/activity/activity-definition';

/**
 * Where activities come from. The seed files are the implementation today and
 * PostgreSQL is `08-add-data-persistence`; the port is what lets the store
 * change without any activity noticing. The file-backed implementation stays
 * afterwards — it is what keeps "an activity is data" true for a developer with
 * no database running.
 */
export interface ActivityCataloguePort {
  /** Every active declaration, in a stable order. */
  activities(): readonly ResolvedDefinition[];
  find(code: string): ResolvedDefinition | undefined;
}

export const ACTIVITY_CATALOGUE: unique symbol = Symbol('ActivityCataloguePort');
