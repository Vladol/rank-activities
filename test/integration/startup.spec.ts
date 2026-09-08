import { readFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../../src/app.module';
import { bootstrap } from '../../src/bootstrap';
import { SchemaGuardService } from '../../src/infrastructure/db/schema-guard.service';
import { readMigrations } from '../../src/infrastructure/db/migrations';
import {
  type TestDatabase,
  migratedDatabase,
  partiallyMigratedDatabase,
} from './support/database';

const started: (INestApplication | undefined)[] = [];
const databases: TestDatabase[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((app) => app?.close()));
  await Promise.all(databases.splice(0).map((database) => database.close()));
  delete process.env.DATABASE_URL;
});

/** A free port per run: the suite must not fight the developer's own server. */
function start(url: string): Promise<{ app?: INestApplication; exits: number[]; errors: string[] }> {
  process.env.DATABASE_URL = url;
  process.env.PORT = String(20_000 + Math.floor(Math.random() * 20_000));

  const exits: number[] = [];
  const errors: string[] = [];

  return bootstrap({
    exit: (code) => exits.push(code),
    logger: { error: (message: unknown) => errors.push(String(message)) } as never,
  }).then((app) => {
    started.push(app);

    return { app, exits, errors };
  });
}

describe('starting against a schema that is not the expected one', () => {
  it('exits non-zero, names both states and serves nothing', async () => {
    const database = await partiallyMigratedDatabase(4);
    databases.push(database);

    const { app, exits, errors } = await start(database.url);

    expect(exits).toEqual([1]);
    expect(app).toBeUndefined();
    // Both halves, because "the schema is wrong" is not something an operator
    // can act on at three in the morning and "expected X, found Y" is.
    expect(errors.join('\n')).toContain('0006_audit');
    expect(errors.join('\n')).toContain('Run the migration step of the deploy');
  });

  it('leaves the schema exactly as it found it', async () => {
    const database = await partiallyMigratedDatabase(4);
    databases.push(database);

    const before = await tableNames(database);
    await start(database.url);

    expect(await tableNames(database)).toEqual(before);
  });
});

describe('starting against a schema at head', () => {
  it('starts, and changes no part of the schema', async () => {
    const database = await migratedDatabase();
    databases.push(database);

    const before = await tableNames(database);
    const { app, exits } = await start(database.url);

    expect(exits).toEqual([]);
    expect(app).toBeDefined();
    expect(await tableNames(database)).toEqual(before);
  });

  it('performs no schema change when several instances start at once', async () => {
    const database = await migratedDatabase();
    databases.push(database);

    const before = await tableNames(database);
    const applied = await migrationHashes(database);

    process.env.DATABASE_URL = database.url;

    // Three at once against one store, and no HTTP: what is under test is what
    // starting does to the schema, and migration is a deploy step precisely so
    // that a rolling restart has no writers in it (design.md, Decision 6).
    const contexts = await Promise.all([context(), context(), context()]);
    const states = await Promise.all(contexts.map((one) => one.get(SchemaGuardService).verify()));

    await Promise.all(contexts.map((one) => one.close()));

    expect(states.map((state) => state.kind)).toEqual(['at_head', 'at_head', 'at_head']);
    expect(await tableNames(database)).toEqual(before);
    expect(await migrationHashes(database)).toEqual(applied);
  });
});

describe('the migration set', () => {
  it('is applied by the deploy step and by nothing the service runs', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(scripts['db:migrate']).toContain('migrate');
    for (const command of ['start', 'start:dev', 'start:prod', 'test', 'test:e2e']) {
      expect(scripts[command] ?? '').not.toContain('migrate');
    }
  });

  it('knows six migrations, in the order data-model.md section 9 fixes', () => {
    expect(readMigrations().map((one) => one.tag)).toEqual([
      '0001_reference',
      '0002_rules',
      '0003_locations',
      '0004_applicability',
      '0005_place_lookup',
      '0006_audit',
    ]);
  });
});

function context(): Promise<Awaited<ReturnType<typeof NestFactory.createApplicationContext>>> {
  return NestFactory.createApplicationContext(AppModule, { logger: false });
}

async function tableNames(database: TestDatabase): Promise<readonly string[]> {
  const rows = await database.db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema IN ('public', 'drizzle') ORDER BY 1
  `);

  return rows.rows.map((row) => row.table_name);
}

async function migrationHashes(database: TestDatabase): Promise<readonly string[]> {
  const rows = await database.db.execute<{ hash: string }>(
    sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`,
  );

  return rows.rows.map((row) => row.hash);
}
