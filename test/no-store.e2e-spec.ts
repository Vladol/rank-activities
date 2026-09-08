import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { ACTIVITY_CATALOGUE, type ActivityCataloguePort } from '../src/modules/activities/ports/activity-catalogue.port';
import { RankingService } from '../src/modules/ranking/ranking.service';

/**
 * The whole service, started with no `DATABASE_URL` at all.
 *
 * This is the claim `ADR 0007` and design.md Decision 2 are built on: the
 * repository is the source of truth for the rules, so development, the unit
 * suite and this suite need no PostgreSQL — and a database outage cannot leave
 * the service unable to do anything at all.
 *
 * What is *not* available without a store is stated in the degradation table and
 * exercised in `test/integration/degradation.spec.ts`: nothing is durable, so
 * the two-phase marine probe cannot terminate and no audit is kept.
 */
describe('the service with no store (e2e)', () => {
  let app: INestApplication;
  const withoutStore = process.env.DATABASE_URL;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();

    if (withoutStore !== undefined) {
      process.env.DATABASE_URL = withoutStore;
    }
  });

  it('starts at all', () => {
    expect(app).toBeDefined();
  });

  it('loads and validates its rules from the repository', () => {
    const catalogue = app.get<ActivityCataloguePort>(ACTIVITY_CATALOGUE);

    expect(catalogue.activities().map((one) => one.code).toSorted()).toEqual([
      'indoor-sightseeing',
      'outdoor-sightseeing',
      'ski',
      'surfing',
    ]);
  });

  it('ranks a location, from rules in memory and data from the recorded sources', async () => {
    const answered = await app.get(RankingService).rank({
      location: { kind: 'coordinates', coordinates: { latitude: 38.7167, longitude: -9.1333 } },
    });

    expect(answered.ok).toBe(true);
    if (answered.ok) {
      expect(answered.value.days[0]?.ranking.ranked.length).toBeGreaterThan(0);
    }
  });

  it('answers a GraphQL query end to end', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: 'query Rank($input: RankingInput!) { rankActivities(input: $input) { days { date } } }',
        variables: { input: { location: { latitude: 38.7167, longitude: -9.1333 }, days: 1 } },
      })
      .expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.rankActivities.days).toHaveLength(1);
  });

  it('reports ready, because running without a store is a stated mode and not a broken deploy', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(response.body).toEqual({ status: 'ready', store: 'not_configured' });
  });
});
