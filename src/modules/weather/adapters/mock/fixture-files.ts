import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { type FixtureManifest, MANIFEST_FILE } from './fixture-manifest';

/**
 * Where the recorded fixtures live on disk.
 *
 * Resolved from the working directory rather than from the module's own
 * location: this file is compiled to CommonJS for the app and to ES modules for
 * the test run, and only one of `__dirname` and `import.meta.url` exists in
 * each. The recorded sources are the development default and are started from
 * the repository root; every reader takes the directory as an argument, so a
 * test can point at its own.
 */
export function fixtureDir(): string {
  return join(process.cwd(), 'src/modules/weather/adapters/mock/fixtures');
}

export function readManifest(dir: string = fixtureDir()): FixtureManifest {
  return JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')) as FixtureManifest;
}

/** The raw recorded body, byte for byte. Nothing between the file and the adapter. */
export function readFixtureBody(file: string, dir: string = fixtureDir()): string {
  return readFileSync(join(dir, file), 'utf8');
}

/** Everything in the fixture directory except the manifest itself. */
export function listFixtureFiles(dir: string = fixtureDir()): readonly string[] {
  return readdirSync(dir)
    .filter((file) => file !== MANIFEST_FILE)
    .toSorted();
}
