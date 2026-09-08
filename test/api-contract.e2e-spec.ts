import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';

const LISBON = { latitude: 38.7167, longitude: -9.1333 };

/**
 * What the published contract says, read off the schema the service generates
 * rather than off the decorators that produced it. A test that read the
 * decorators would pass for a schema nobody could query.
 */
describe('The published contract (e2e)', () => {
  let app: INestApplication;
  /**
   * The generated SDL, read from the file the service writes on every start.
   * Reading the artefact rather than the in-process schema object is both more
   * honest — it is what a client would be handed — and the only way to inspect
   * it from a test, because `graphql` ships two module realms and objects from
   * one are strangers to the functions of the other.
   */
  let sdl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sdl = readFileSync(join(process.cwd(), 'src/schema.gql'), 'utf8');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function post(body: object) {
    return request(app.getHttpServer()).post('/graphql').send(body);
  }

  describe('the query and its bounds', () => {
    it('states the horizon range in the schema, not only in a validator', () => {
      expect(sdl).toMatch(/from 1 to \d+/);
      expect(sdl).toContain('HORIZON_TOO_LARGE');
      expect(sdl).toContain('rather than shortened');
    });

    it('offers no way to ask about several locations at once', () => {
      // One location, one argument. Multi-location arrives as a second field
      // beside this one, which no existing query has to notice.
      expect(sdl).toContain('rankActivities(input: RankingInput!)');
      expect(sdl).toMatch(/input RankingInput \{[^}]*location: LocationInput!/s);
      expect(sdl).not.toMatch(/locations\s*:/);
    });

    it('takes a name and a point through the same query', async () => {
      const byName = await post({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { location { name } } }',
        variables: { i: { location: { name: 'Lisbon' }, days: 1 } },
      });
      const byPoint = await post({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { location { latitude } } }',
        variables: { i: { location: LISBON, days: 1 } },
      });

      expect(byName.body.errors).toBeUndefined();
      expect(byPoint.body.errors).toBeUndefined();
    });

    it('refuses a request naming both a name and a point, and one naming neither', async () => {
      const both = await post({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { requestedDays } }',
        variables: { i: { location: { name: 'Lisbon', ...LISBON } } },
      });
      const neither = await post({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { requestedDays } }',
        variables: { i: { location: {} } },
      });

      expect(both.body.errors[0].extensions.code).toBe('INVALID_LOCATION_INPUT');
      expect(neither.body.errors[0].extensions.code).toBe('INVALID_LOCATION_INPUT');
    });

    it('tells an unreadable point from a name it could not match', async () => {
      const offEarth = await post({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { requestedDays } }',
        variables: { i: { location: { latitude: 999, longitude: 0 } } },
      });
      const unknown = await post({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { requestedDays } }',
        variables: { i: { location: { name: 'Zzzqqxwv' } } },
      });

      expect(offEarth.body.errors[0].extensions.code).toBe('INVALID_COORDINATES');
      expect(unknown.body.errors[0].extensions.code).toBe('LOCATION_NOT_FOUND');
    });
  });

  describe('the outcome union', () => {
    it('is three types, with no nullable score standing in for another state', () => {
      const declared = /union ActivityOutcome = (.+)/.exec(sdl)?.[1] ?? '';

      expect(
        declared
          .split('|')
          .map((name) => name.trim())
          .toSorted(),
      ).toEqual(['NoDataOutcome', 'NotApplicableOutcome', 'RankedOutcome']);
      // `score: Int!`, never `score: Int`. A null score is exactly the "zero
      // instead of an honest refusal" the domain forbids (design.md, Decision 1).
      expect(sdl).toContain('score: Int!');
      expect(sdl).not.toMatch(/type (NoData|NotApplicable)Outcome \{[^}]*score/s);
    });

    it('refuses a query that reads the union as though it were one flat type', async () => {
      const response = await post({
        query: `query R($i: RankingInput!) {
          rankActivities(input: $i) { days { ranked { outcome { score } } } }
        }`,
        variables: { i: { location: LISBON, days: 1 } },
      });

      expect(response.body.data).toBeFalsy();
      expect(response.body.errors[0].extensions.code).toBe('INVALID_QUERY');
      expect(response.body.errors[0].message).toContain('ActivityOutcome');
    });

    it('carries the metadata an answer is only honest with', async () => {
      const response = await post({
        query: `query R($i: RankingInput!) {
          rankActivities(input: $i) {
            timezone requestedDays fetchedAt stale profileId profileVersion
            location { id latitude longitude }
            scope { code messageKey excludes }
            days { date complete hoursCounted }
          }
        }`,
        variables: { i: { location: LISBON, days: 2 } },
      });
      const answer = response.body.data.rankActivities;

      expect(answer.timezone).toBe('Europe/Lisbon');
      expect(answer.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(answer.stale).toBe(false);
      expect(answer.profileVersion).toBeGreaterThan(0);
      expect(answer.scope.code).toBe('WEATHER_ONLY');
      expect(answer.scope.excludes.length).toBeGreaterThan(0);
      expect(answer.days).toHaveLength(2);
    });

    it('explains a score in the same response, and marks a dropped feature as dropped', async () => {
      const response = await post({
        query: `query R($i: RankingInput!) {
          rankActivities(input: $i) {
            days { ranked { activity outcome { __typename
              ... on RankedOutcome {
                score
                breakdown { featureId metric role status normalized weight gateFactor
                            raw { value unit sampleCount missingCount } }
              } } } }
          }
        }`,
        variables: { i: { location: LISBON, days: 1 } },
      });
      const breakdown = response.body.data.rankActivities.days[0].ranked.flatMap(
        (entry: { outcome: { breakdown?: unknown[] } }) => entry.outcome.breakdown ?? [],
      );

      expect(breakdown.length).toBeGreaterThan(0);

      for (const feature of breakdown) {
        expect(typeof feature.metric).toBe('string');
        expect(['ADDITIVE', 'GATE']).toContain(feature.role);

        if (feature.role === 'ADDITIVE') {
          expect(typeof feature.weight).toBe('number');
        } else {
          expect(typeof feature.gateFactor).toBe('number');
        }
      }

      const used = breakdown.filter((feature: { status: string }) => feature.status === 'USED');

      expect(used.length).toBeGreaterThan(0);
      expect(used.every((feature: { raw: unknown }) => feature.raw !== null)).toBe(true);

      // A feature that was dropped says so and has no raw value. It is not a
      // contribution of zero, which would read as "this counted, and badly".
      for (const dropped of breakdown.filter(
        (feature: { status: string }) => feature.status === 'EXCLUDED',
      )) {
        expect(dropped.raw).toBeNull();
        expect(dropped.contribution ?? null).toBeNull();
      }
    });

    it('costs one activity, not the answer, when one has no data', async () => {
      // Prague has no sea, so surfing is answered for without being ranked
      // while the other three are.
      const response = await post({
        query: `query R($i: RankingInput!) {
          rankActivities(input: $i) {
            days { ranked { activity } notRanked { activity outcome { __typename
              ... on NotApplicableOutcome { reason messageKey }
              ... on NoDataOutcome { reason messageKey missingMetrics retryable } } } }
          }
        }`,
        variables: { i: { location: { latitude: 50.0875, longitude: 14.4213 }, days: 1 } },
      });
      const day = response.body.data.rankActivities.days[0];

      expect(response.body.errors).toBeUndefined();
      expect(day.ranked.length).toBeGreaterThan(0);
      expect(day.notRanked.map((entry: { activity: string }) => entry.activity)).toContain(
        'surfing',
      );

      for (const entry of day.notRanked) {
        expect(entry.outcome.__typename).not.toBe('RankedOutcome');
        expect(entry.outcome.reason).toMatch(/^[A-Z_]+$/);
        expect(entry.outcome.messageKey).toBe(`reason.${entry.outcome.reason.toLowerCase()}`);
      }
    });
  });

  describe('the bounds on the endpoint', () => {
    // The depth limit and the inbound limit are exercised in
    // `api-limits.e2e-spec.ts`, which boots the service with bounds small
    // enough for a legitimate query to cross them.
    it('refuses a batch of operations travelling as one request', async () => {
      // A batch passes the inbound limiter once for arbitrarily much work, and
      // it breaks the one-request-one-trace-identifier correspondence.
      const response = await post([{ query: '{ hello }' }, { query: '{ hello }' }]);

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain('Hello World');
    });
  });
});
