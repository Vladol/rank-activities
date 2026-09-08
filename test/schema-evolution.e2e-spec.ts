import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kind, parse, print, type TypeNode } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';

const GENERATED = join(process.cwd(), 'src/schema.gql');
const SNAPSHOT = join(process.cwd(), 'test/schema.snapshot.graphql');

/**
 * The contract, checked in.
 *
 * `src/schema.gql` is generated on every start and is not in the repository, so
 * a change to the published contract would otherwise be invisible in review:
 * it would appear as a decorator moved in a file nobody reads as a contract.
 * The snapshot beside this test is the contract as it stands; changing it is a
 * deliberate act with a diff attached.
 */
describe('How the published schema is allowed to change (e2e)', () => {
  let app: INestApplication;
  let generated: string;
  const snapshot = readFileSync(SNAPSHOT, 'utf8');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    generated = readFileSync(GENERATED, 'utf8');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('matches the snapshot, so a contract change is a diff a reviewer sees', () => {
    if (generated !== snapshot) {
      // Written beside the snapshot rather than over it: updating the contract
      // is the author's decision, and this only makes it one command.
      writeFileSync(`${SNAPSHOT}.actual`, generated);
    }

    expect(
      generated,
      'The published schema changed. Read the difference, and if it is intended run:\n' +
        '  cp test/schema.snapshot.graphql.actual test/schema.snapshot.graphql',
    ).toBe(snapshot);
  });

  it('adds only optional fields to a type that already existed', () => {
    // Additive by rule: an existing query must keep answering identically, and
    // a required field added to an existing type breaks every client that ever
    // sent one (spec, "The schema is generated and evolves additively").
    for (const [type, fields] of fieldsByType(generated)) {
      const before = fieldsByType(snapshot).get(type);

      if (before === undefined) {
        continue;
      }

      for (const [field, printed] of fields) {
        if (!before.has(field)) {
          expect(printed, `${type}.${field} is new and must be optional`).not.toMatch(/!$/);
        }
      }
    }
  });

  it('removes nothing that was not first marked deprecated', () => {
    for (const [type, fields] of fieldsByType(snapshot)) {
      const now = fieldsByType(generated).get(type);

      if (now === undefined) {
        continue;
      }

      for (const field of fields.keys()) {
        expect(now.has(field), `${type}.${field} vanished; deprecate it first`).toBe(true);
      }
    }
  });
});

/** Every object and input type in an SDL document, and the type of each field. */
function fieldsByType(sdl: string): Map<string, Map<string, string>> {
  const types = new Map<string, Map<string, string>>();

  for (const definition of parse(sdl).definitions) {
    if (
      definition.kind !== Kind.OBJECT_TYPE_DEFINITION &&
      definition.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION
    ) {
      continue;
    }

    types.set(
      definition.name.value,
      new Map(
        (definition.fields ?? []).map((field) => [
          field.name.value,
          print(field.type as TypeNode),
        ]),
      ),
    );
  }

  return types;
}
