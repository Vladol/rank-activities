import type { ResolvedDefinition } from '../../../domain/activity/activity-definition';

/**
 * Where activities come from. The seed files are the implementation today and
 * PostgreSQL is `08-add-data-persistence`; the port is what lets the store
 * change without any activity noticing. The file-backed implementation stays
 * afterwards — it is what keeps "an activity is data" true for a developer with
 * no database running.
 */
export interface ActivityCataloguePort {
  /**
   * One declaration per activity — the highest published version of each, in a
   * stable order. This is the set that gets ranked, and an activity absent
   * from it is produced by no other path.
   */
  activities(): readonly ResolvedDefinition[];
  find(code: string): ResolvedDefinition | undefined;
  /**
   * A specific published version. A result computed a month ago names the
   * version it used, and reproducing it means reading that version back.
   */
  findVersion(code: string, version: number): ResolvedDefinition | undefined;
}

export const ACTIVITY_CATALOGUE: unique symbol = Symbol('ActivityCataloguePort');
