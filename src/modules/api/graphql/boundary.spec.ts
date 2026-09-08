import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RankingAnswer } from '../../../domain/ranking/ranking-answer';
import { toRankingAnswerModel } from './ranking.mapper';

const ROOT = process.cwd();
const DECORATORS = /@(ObjectType|InputType|Field|ArgsType|Directive)\b|createUnionType|registerEnumType/;

function filesUnder(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(directory, entry.name)]
        : [],
  );
}

/**
 * The line the published contract is drawn on.
 *
 * Both halves matter and neither implies the other: the core must not learn
 * about the transport, and the transport must not publish the core. Together
 * they are what makes a rename inside the domain something a client never sees
 * (design.md, Decision 3).
 */
describe('the boundary between the core and what is published', () => {
  it('keeps every transport concern out of the pure core', () => {
    for (const file of filesUnder('src/domain')) {
      const source = readFileSync(join(ROOT, file), 'utf8');

      expect(source, file).not.toMatch(DECORATORS);
      expect(source, file).not.toContain('@nestjs/graphql');
    }
  });

  it('declares every published type in the one directory that may declare them', () => {
    const declaring = filesUnder('src')
      .filter((file) => DECORATORS.test(readFileSync(join(ROOT, file), 'utf8')))
      .filter((file) => !file.endsWith('.spec.ts'));

    expect(declaring.length).toBeGreaterThan(0);

    for (const file of declaring) {
      expect(file.replaceAll('\\', '/'), file).toMatch(/^src\/modules\/api\/graphql\//);
    }
  });

  it('publishes no field the models did not ask for, whatever the domain grows', () => {
    // The mapper writes every field out by name rather than by spread, which is
    // the whole point: a field added to a domain type does not escape into a
    // public contract by accident.
    const answer = {
      location: {
        id: '38.72,-9.13',
        coordinates: { latitude: 38.72, longitude: -9.13 },
        timezone: 'Europe/Lisbon',
        elevationMetres: 10,
        place: null,
        internalScratchpad: 'never published',
      },
      timezone: 'Europe/Lisbon',
      requestedDays: 1,
      days: [],
      undated: [],
      fetchedAt: null,
      stale: false,
      profileId: 'default',
      profileVersion: 1,
      scope: { code: 'WEATHER_ONLY', i18n: 'scope.weather_only', excludes: [] },
      auditRequestId: 'never published',
    } as unknown as RankingAnswer;

    const model = toRankingAnswerModel(answer);

    expect(JSON.stringify(model)).not.toContain('never published');
    expect(Object.keys(model)).not.toContain('auditRequestId');
  });
});
