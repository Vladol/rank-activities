import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The guard on the guard.
 *
 * `test/contract/` is the only place in the repository that reaches the
 * network, and the only thing keeping it out of `npm test` is a glob. A glob
 * that quietly widens is exactly the kind of change nobody notices until CI
 * starts failing on a third party's outage, so the exclusion is asserted here
 * — in the default run, where a break shows up immediately.
 */
const DEFAULT_CONFIGS = ['vitest.config.mts', 'vitest.config.e2e.mts'];

describe('the live contract test stays out of the default runs', () => {
  it('is matched by neither default configuration', () => {
    for (const config of DEFAULT_CONFIGS) {
      const source = readFileSync(config, 'utf8');
      const include = /include:\s*\[(?<globs>[^\]]*)]/.exec(source)?.groups?.globs ?? '';

      expect(include, `${config} includes something under test/contract`).not.toContain(
        'test/contract',
      );
      // `test/**/*.spec.ts` would sweep it in without naming it.
      expect(include).not.toContain("'test/**/*.spec.ts'");
    }
  });

  it('keeps the socket guard on both default runs', () => {
    for (const config of DEFAULT_CONFIGS) {
      // The stronger claim: even if a contract test were swept in, the guard
      // would fail it rather than let it dial out.
      expect(readFileSync(config, 'utf8')).toContain('no-network.ts');
    }
  });

  it('runs the contract suite under a configuration of its own', () => {
    const contract = readFileSync('vitest.config.contract.mts', 'utf8');

    expect(contract).toContain('test/contract');
    // It is the one run without the guard, on purpose and nowhere else.
    expect(contract).not.toContain('no-network.ts');
  });
});
