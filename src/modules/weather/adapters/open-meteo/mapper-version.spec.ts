import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAPPER_VERSION } from './open-meteo.mapper';

const ROOT = process.cwd();

function typescriptUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return typescriptUnder(path);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('the mapper declares the version of its own behaviour', () => {
  it('exports a version', () => {
    expect(MAPPER_VERSION).toMatch(/^\d+$/);
  });

  it('declares it exactly once in the tree', () => {
    // It is invalidated by an edit to a mapper, and a version that lives away
    // from the thing it versions is a version nobody remembers to raise
    // (design.md, Decision 8). A second declaration is the same failure by
    // another route: the cache key in `07` would be namespaced by one copy
    // while the mapping changed under the other.
    const declarations = [...typescriptUnder(join(ROOT, 'src')), ...typescriptUnder(join(ROOT, 'test'))]
      // Tests are excluded: `07`'s key builder is checked by loading a second
      // copy of the module under a raised version, and the mock that does it
      // names the constant without declaring one.
      .filter((path) => !path.endsWith('.spec.ts'))
      .filter((path) => /MAPPER_VERSION\s*(:[^=]*)?=/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path));

    expect(declarations).toEqual(['src/modules/weather/adapters/open-meteo/open-meteo.mapper.ts']);
  });
});
