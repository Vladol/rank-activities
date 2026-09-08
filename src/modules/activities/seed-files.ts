import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the declarations live on disk.
 *
 * Resolved from the working directory rather than from this module's own
 * location, for the same reason the fixtures are: the file is compiled to
 * CommonJS for the app and to ES modules for the test run, and only one of
 * `__dirname` and `import.meta.url` exists in each. Every reader takes the
 * directory as an argument, so a test can point at its own.
 */
export const SHARED_RULES_FILE = 'shared-rules.json';

const DECLARATION_SUFFIX = '.activity.json';

export function seedDir(): string {
  return join(process.cwd(), 'src/modules/activities/seeds');
}

export interface SeedFiles {
  readonly declarations: readonly unknown[];
  readonly sharedRules: unknown;
}

/**
 * Reads every declaration in the directory, in file-name order so that two
 * runs over the same directory produce the same catalogue.
 */
export function readSeedFiles(dir: string = seedDir()): SeedFiles {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(DECLARATION_SUFFIX))
    .toSorted();

  return {
    declarations: files.map((file) => readJson(join(dir, file))),
    sharedRules: readJson(join(dir, SHARED_RULES_FILE)),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
