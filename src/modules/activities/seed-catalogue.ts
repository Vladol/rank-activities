import type { ResolvedDefinition } from '../../domain/activity/activity-definition';
import { type DeclarationFault, loadDeclarations } from '../../domain/activity/declaration.load';
import { isErr } from '../../domain/shared/result';
import type { ActivityCataloguePort } from './ports/activity-catalogue.port';
import { readSeedFiles, seedDir } from './seed-files';

/**
 * The catalogue over the seed files. Adding an activity is a sixth file here
 * and no TypeScript at all; that claim is what the change is for, and
 * `test/acceptance/a-fifth-activity.spec.ts` holds it up.
 *
 * An invalid declaration throws, which stops the application from starting.
 * That is the deliberate trade of design.md: a startup failure naming the
 * declaration, the feature and the fault, rather than a NaN reaching a user at
 * request time. A broken declaration is never skipped so the others can load.
 */
export class SeedActivityCatalogue implements ActivityCataloguePort {
  /** The highest version of each activity: what gets ranked. */
  private readonly active: readonly ResolvedDefinition[];

  private readonly byCode: ReadonlyMap<string, ResolvedDefinition>;

  private constructor(private readonly definitions: readonly ResolvedDefinition[]) {
    // A published version stays reachable so a past computation can be
    // reproduced, but only one version of an activity is offered: ranking an
    // activity twice, or keeping whichever file happened to be read last,
    // are both the silent overwrite the version check exists to prevent.
    const latest = new Map<string, ResolvedDefinition>();

    for (const definition of definitions) {
      const known = latest.get(definition.code);

      if (known === undefined || definition.version > known.version) {
        latest.set(definition.code, definition);
      }
    }

    this.byCode = latest;
    this.active = [...latest.values()];
  }

  static load(dir: string = seedDir()): SeedActivityCatalogue {
    const { declarations, sharedRules } = readSeedFiles(dir);
    const result = loadDeclarations(declarations, sharedRules);

    if (isErr(result)) {
      throw new Error(describe(result.error));
    }

    return new SeedActivityCatalogue(result.value);
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

function describe(faults: readonly DeclarationFault[]): string {
  const lines = faults.map((fault) => `  ${fault.activity} ${fault.path}: ${fault.message}`);

  return `The activity catalogue is invalid and the service will not start:\n${lines.join('\n')}`;
}
