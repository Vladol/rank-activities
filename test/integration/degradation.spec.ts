import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { REASON, isReasonCode } from '../../src/domain/shared/reason-code';
import { RankingService } from '../../src/modules/ranking/ranking.service';
import { seed } from '../../src/infrastructure/db/seed/seed';
import { seedDemonstrationProfiles } from '../../src/infrastructure/db/seed/demonstration-locations';
import {
  type TestDatabase,
  disconnect,
  migratedDatabase,
  partiallyMigratedDatabase,
} from './support/database';

const KNOWN = { kind: 'coordinates', coordinates: { latitude: 38.7167, longitude: -9.1333 } } as const;
const UNKNOWN = { kind: 'coordinates', coordinates: { latitude: 12.34, longitude: 56.78 } } as const;

let database: TestDatabase;
let app: INestApplication;

beforeAll(async () => {
  database = await migratedDatabase();
  await seed(database.db);
  // Lisbon is warm before the outage; that is what "known" means.
  await seedDemonstrationProfiles(database.db);

  process.env.DATABASE_URL = database.url;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  // Read it once while the store is up, so this instance's mirror holds it —
  // which is what an instance that has been serving traffic looks like.
  await app.get(RankingService).rank({ location: KNOWN });

  await disconnect(database);
});

afterAll(async () => {
  await app?.close();
  await database?.close();
  delete process.env.DATABASE_URL;
});

describe('with the store gone', () => {
  it('still ranks a location whose profile is known', async () => {
    const answered = await app.get(RankingService).rank({ location: KNOWN });

    expect(answered.ok).toBe(true);
    // Not an error, not a degraded shape: the ordinary answer, from rules in
    // memory and data from the cache.
    if (answered.ok) {
      expect(answered.value.days.length).toBeGreaterThan(0);
      expect(answered.value.days[0]?.ranking.ranked.length).toBeGreaterThan(0);
    }
  });

  it('refuses a location it has never profiled, and says which thing is missing', async () => {
    const answered = await app.get(RankingService).rank({ location: UNKNOWN });

    expect(answered.ok).toBe(false);
    if (!answered.ok) {
      expect(answered.error.code).toBe('PROFILE_UNAVAILABLE');
    }
  });

  it('tells that refusal apart from a place that does not exist', async () => {
    const missing = await app.get(RankingService).rank({
      location: { kind: 'name', name: 'Zzzqqxwv' },
    });

    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      // Two different facts: "there is no such place" and "we cannot reach what
      // we know about places". A client acts differently on each.
      expect(missing.error.code).toBe('LOCATION_NOT_FOUND');
    }
  });

  it('reports itself not ready, and names the store as the reason', async () => {
    // 503, because an orchestrator reads the status line and not the body.
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);

    expect(response.body.status).toBe('not_ready');
    expect(response.body.store).toBe('unreachable');
  });

  it('stays alive, because a store outage is not a reason to restart a healthy process', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);

    expect(response.body.status).toBe('ok');
  });
});

describe('readiness against a schema that is not at head', () => {
  it('is red, and says so as a mismatch rather than as an outage', async () => {
    const behind = await partiallyMigratedDatabase(3);

    process.env.DATABASE_URL = behind.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const stale = moduleRef.createNestApplication();

    await stale.init();

    try {
      const response = await request(stale.getHttpServer()).get('/health/ready').expect(503);

      expect(response.body.status).toBe('not_ready');
      expect(response.body.store).toBe('schema_mismatch');
      expect(response.body.detail).toContain('0006_audit');
    } finally {
      await stale.close();
      await behind.close();
      process.env.DATABASE_URL = database.url;
    }
  });
});

describe('the reason for an unavailable profile', () => {
  it('is a code from the one registry and not a free-form string', () => {
    expect(isReasonCode('PROFILE_UNAVAILABLE')).toBe(true);
    expect(REASON.PROFILE_UNAVAILABLE.kind).toBe('no_data');
    // Asking again may help: the store may come back, and the place is real.
    expect(REASON.PROFILE_UNAVAILABLE.retryable).toBe(true);
  });
});
