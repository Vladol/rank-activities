import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';

/**
 * The scenario through the booted application, over the recorded sources: one
 * coastal location and one inland one, which between them exercise both a
 * two-host answer and a one-host one.
 *
 * Applicability at an inland place is settled by two probes on different days,
 * and this test boots the application once with the process clock. Prague's
 * surfing is therefore asserted as "not scored and says why" rather than as
 * `NO_COASTLINE_NEARBY` specifically — the first probe honestly answers that
 * the coverage is not yet settled. Which of the two it is on a given day is
 * `04-add-location-applicability`'s question and is asserted there.
 */
const QUERY = `
  query Rank($input: RankingInput!) {
    rankActivities(input: $input) {
      timezone
      requestedDays
      stale
      fetchedAt
      profileId
      profileVersion
      location { id latitude longitude name countryCode }
      scope { code messageKey excludes }
      days {
        date
        complete
        hoursCounted
        ranked {
          activity
          outcome {
            __typename
            ... on RankedOutcome {
              score
              constraintViolated
              definitionVersion
              breakdown { featureId metric role status normalized weight gateFactor raw { value unit } }
            }
          }
        }
        notRanked {
          activity
          outcome {
            __typename
            ... on NotApplicableOutcome { reason messageKey }
            ... on NoDataOutcome { reason messageKey missingMetrics retryable }
          }
        }
      }
    }
  }
`;

describe('Ranking (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function rank(input: Record<string, unknown>) {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: QUERY, variables: { input } })
      .expect(200);

    return response.body as {
      data?: { rankActivities?: Record<string, never> };
      errors?: { message: string; extensions?: Record<string, unknown> }[];
    };
  }

  it('answers for a coastal location with every activity accounted for on every day', async () => {
    const body = await rank({ location: { latitude: 38.7167, longitude: -9.1333 }, days: 3 });
    const answer = body.data?.rankActivities as never as {
      timezone: string;
      requestedDays: number;
      days: {
        date: string;
        complete: boolean;
        hoursCounted: number;
        ranked: { activity: string; outcome: { __typename: string; score?: number } }[];
        notRanked: { activity: string; outcome: { __typename: string; reason?: string } }[];
      }[];
      scope: { code: string };
      profileId: string;
    };

    expect(body.errors).toBeUndefined();
    expect(answer.requestedDays).toBe(3);
    expect(answer.days).toHaveLength(3);
    expect(answer.timezone).toBe('Europe/Lisbon');
    expect(answer.scope.code).toBe('WEATHER_ONLY');
    expect(answer.profileId).toBe('default');

    for (const day of answer.days) {
      expect(day.complete).toBe(true);
      expect(day.hoursCounted).toBe(24);
      expect([...day.ranked, ...day.notRanked].map((entry) => entry.activity).toSorted()).toEqual([
        'indoor-sightseeing',
        'outdoor-sightseeing',
        'ski',
        'surfing',
      ]);

      const scores = day.ranked.map((entry) => entry.outcome.score ?? Number.NaN);

      expect(scores).toEqual(scores.toSorted((left, right) => right - left));
      expect(day.ranked.every((entry) => entry.outcome.__typename === 'RankedOutcome')).toBe(true);
      expect(day.notRanked.every((entry) => entry.outcome.__typename !== 'RankedOutcome')).toBe(
        true,
      );
    }
  });

  it('carries the explanation of a score, dropped features included', async () => {
    const body = await rank({ location: { latitude: 38.7167, longitude: -9.1333 }, days: 1 });
    const answer = body.data?.rankActivities as never as {
      days: {
        ranked: {
          activity: string;
          outcome: {
            breakdown?: { featureId: string; raw: { value: number; unit: string } | null }[];
          };
        }[];
      }[];
    };
    const breakdown = answer.days[0]?.ranked[0]?.outcome.breakdown ?? [];

    expect(breakdown.length).toBeGreaterThan(0);
    expect(breakdown.every((entry) => typeof entry.featureId === 'string')).toBe(true);
    expect(breakdown.some((entry) => entry.raw !== null)).toBe(true);
  });

  it('answers for an inland location without scoring the activity that needs a sea', async () => {
    const body = await rank({ location: { latitude: 50.0875, longitude: 14.4213 }, days: 2 });
    const answer = body.data?.rankActivities as never as {
      days: {
        ranked: { activity: string }[];
        notRanked: { activity: string; outcome: { __typename: string; reason: string } }[];
      }[];
    };

    expect(body.errors).toBeUndefined();

    for (const day of answer.days) {
      expect(day.ranked.map((entry) => entry.activity)).not.toContain('surfing');

      const surfing = day.notRanked.find((entry) => entry.activity === 'surfing');

      expect(surfing).toBeDefined();
      expect(surfing?.outcome.reason).toMatch(/NO_COASTLINE_NEARBY|MARINE_UNAVAILABLE/);
      expect(surfing?.outcome.__typename).not.toBe('RankedOutcome');
    }
  });

  it('refuses an over-long horizon with the reason code, not a shortened answer', async () => {
    const body = await rank({ location: { latitude: 38.7167, longitude: -9.1333 }, days: 30 });

    expect(body.data?.rankActivities ?? null).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('HORIZON_TOO_LARGE');
  });

  it('refuses a request that named neither a name nor a point', async () => {
    const body = await rank({ location: {} });

    expect(body.errors?.[0]?.extensions?.code).toBe('EMPTY');
  });
});
