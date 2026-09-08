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
  private readonly byCode: ReadonlyMap<string, ResolvedDefinition>;

  private constructor(private readonly definitions: readonly ResolvedDefinition[]) {
    this.byCode = new Map(definitions.map((definition) => [definition.code, definition]));
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
    return this.definitions;
  }

  find(code: string): ResolvedDefinition | undefined {
    return this.byCode.get(code);
  }
}

function describe(faults: readonly DeclarationFault[]): string {
  const lines = faults.map((fault) => `  ${fault.activity} ${fault.path}: ${fault.message}`);

  return `The activity catalogue is invalid and the service will not start:\n${lines.join('\n')}`;
}
