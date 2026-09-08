import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';

/**
 * "An activity is data, not code" as something the build checks rather than
 * something a reviewer remembers (docs/development-flow/stage-five.md,
 * section 12, and section 17, readiness criterion 4).
 *
 * The words looked for are read out of the catalogue, so adding a sixth
 * activity extends this test with no edit: the day somebody writes
 * `snow-quality.ts` or a branch on `code === 'ski'`, it fails.
 */
const ACTIVITY_WORDS = [
  ...new Set(
    SeedActivityCatalogue.load()
      .activities()
      .flatMap((activity) => activity.code.split('-')),
  ),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return name.endsWith('.ts') ? [path] : [];
  });
}

const PRODUCTION = (dir: string): string[] =>
  sourceFiles(dir).filter((path) => !path.endsWith('.spec.ts'));

/**
 * The rule is about identifiers, not about prose. A comment that explains *why*
 * the engine knows no activity has to be able to say which activity it does not
 * know: `metric.ts` names surfing precisely to record that nothing states
 * surfing needs marine data. Stripping comments is what makes the check test
 * the rule rather than the documentation of it.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/\/\/.*$/gm, ' ');
}

/**
 * The words an identifier is built from. A plain word-boundary search would
 * miss every shape the rule is actually aimed at — `SKI_BONUS`, `skiScorer`,
 * `scoreSki` — because an underscore and a capital are both word characters.
 * Splitting on case and punctuation catches those and still leaves `skipped`
 * alone, which is the whole difficulty.
 */
function identifierWords(source: string): ReadonlySet<string> {
  return new Set(
    source
      .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z]+/)
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 0),
  );
}

describe('no file is named after an activity', () => {
  it.each(ACTIVITY_WORDS)('no TypeScript file under src is called "%s"', (word) => {
    // Seeds are JSON and are named after activities on purpose; code is not.
    const named = [...sourceFiles('src/domain'), ...sourceFiles('src/modules')].filter((path) =>
      identifierWords(path.split('/').at(-1) ?? '').has(word),
    );

    expect(named).toEqual([]);
  });
});

describe('the engine does not know an activity by name', () => {
  it.each(ACTIVITY_WORDS)('no code under src/domain mentions "%s"', (word) => {
    // A curve named for one activity is a curve the second one will not get;
    // a branch on an activity code is the release the catalogue exists to
    // avoid. Spec files are exempt: naming the case under test is their job.
    const mentions = PRODUCTION('src/domain').filter((path) =>
      identifierWords(code(path)).has(word),
    );

    expect(mentions).toEqual([]);
  });

  it('lets the module layer name the seed files it reads, and nothing more', () => {
    const offenders = PRODUCTION('src/modules').filter((path) =>
      ACTIVITY_WORDS.some((word) => identifierWords(code(path)).has(word)),
    );

    expect(offenders).toEqual([]);
  });
});

describe('what the check is protecting', () => {
  it('reads the words from the catalogue rather than from a list here', () => {
    expect(ACTIVITY_WORDS).toContain('ski');
    expect(ACTIVITY_WORDS).toContain('surfing');
    expect(ACTIVITY_WORDS).toContain('indoor');
  });
});
