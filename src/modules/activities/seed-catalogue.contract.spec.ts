import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll } from 'vitest';

import { describeCatalogueContract } from './contract/activity-catalogue.conformance';
import { SeedActivityCatalogue } from './seed-catalogue';
import { SHARED_RULES_FILE } from './seed-files';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describeCatalogueContract('file-backed', (declarations, sharedRules) => {
  const dir = mkdtempSync(join(tmpdir(), 'catalogue-contract-'));

  scratch.push(dir);
  writeFileSync(join(dir, SHARED_RULES_FILE), JSON.stringify(sharedRules));

  for (const [at, declaration] of declarations.entries()) {
    writeFileSync(join(dir, `${at}-declaration.activity.json`), JSON.stringify(declaration));
  }

  return Promise.resolve(SeedActivityCatalogue.load(dir));
});
