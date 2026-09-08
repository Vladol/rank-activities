import type { ResolvedDefinition } from '../../domain/activity/activity-definition';
import type { ActivityCataloguePort } from './ports/activity-catalogue.port';

/**
 * A set of published declarations, indexed the two ways the port asks for.
 *
 * It is shared by both adapters rather than written twice, because "one version
 * of each activity is ranked and every published version stays reachable" is a
 * property of the catalogue and not of where the rows came from. Two copies of
 * this rule would be two chances to break it (design.md, Decision 8).
 */
export class IndexedCatalogue implements ActivityCataloguePort {
  /** The highest version of each activity: what gets ranked. */
  private readonly active: readonly ResolvedDefinition[];

  private readonly byCode: ReadonlyMap<string, ResolvedDefinition>;

  constructor(private readonly definitions: readonly ResolvedDefinition[]) {
    // A published version stays reachable so a past computation can be
    // reproduced, but only one version of an activity is offered: ranking an
    // activity twice, or keeping whichever row happened to be read last, are
    // both the silent overwrite the version check exists to prevent.
    const latest = new Map<string, ResolvedDefinition>();

    for (const definition of definitions) {
      const known = latest.get(definition.code);

      if (known === undefined || definition.version > known.version) {
        latest.set(definition.code, definition);
      }
    }

    this.byCode = latest;
    // Sorted by code, so the order does not depend on what the file system or
    // the planner happened to answer with; a tie-break that did would be
    // untestable.
    this.active = [...latest.values()].toSorted((left, right) =>
      left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
    );
  }

  activities(): readonly ResolvedDefinition[] {
    return this.active;
  }

  find(code: string): ResolvedDefinition | undefined {
    return this.byCode.get(code);
  }

  /** A specific published version, for reproducing a computation made under it. */
  findVersion(code: string, version: number): ResolvedDefinition | undefined {
    return this.definitions.find(
      (definition) => definition.code === code && definition.version === version,
    );
  }
}
