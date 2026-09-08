import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { isReasonCode } from '../src/domain/shared/reason-code';

/**
 * The reference cases of docs/development-flow/stage-two.md, section 12, driven
 * through the published surface rather than through the scoring engine.
 *
 * `test/acceptance/` already asserts what each of them scores; what is under
 * test here is the other half — that the answer reaches a client as the right
 * *kind* of thing. A case that scores correctly and arrives as a null field has
 * failed at exactly the point this change exists to cover.
 *
 * Only the cases a forecast horizon can serve are here. Chamonix in summer,
 * Tromsø in December, Dubai in July, the Galway storm and the flat Odessa sea
 * are recorded over past windows, and the query deliberately takes no start
 * date: they stay where they are asserted, against the same recordings.
 */
const CASES = [
  { name: 'prague-inland', location: { latitude: 50.0875, longitude: 14.4213 } },
  { name: 'lisbon-surf', location: { latitude: 38.7167, longitude: -9.1333 } },
  { name: 'chamonix-winter-ski', location: { latitude: 45.9237, longitude: 6.8694 } },
  { name: 'queenstown-nz-ski', location: { latitude: -45.0312, longitude: 168.6626 } },
  { name: 'london-rainy', location: { latitude: 51.5085, longitude: -0.1257 } },
] as const;

const ACTIVITIES = ['indoor-sightseeing', 'outdoor-sightseeing', 'ski', 'surfing'];

const QUERY = `query R($i: RankingInput!) {
  rankActivities(input: $i) {
    location { name countryCode latitude longitude }
    days {
      date
      ranked { activity outcome { __typename ... on RankedOutcome { score constraintViolated } } }
      notRanked { activity outcome { __typename
        ... on NotApplicableOutcome { reason }
        ... on NoDataOutcome { reason } } }
    }
  }
}`;

interface Entry {
  readonly activity: string;
  readonly outcome: { __typename: string; score?: number; reason?: string };
}

describe('The reference cases through the API (e2e)', () => {
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
      .send({ query: QUERY, variables: { i: input } })
      .expect(200);

    return response.body as {
      data?: {
        rankActivities: {
          location: { name: string | null; countryCode: string | null; latitude: number };
          days: { date: string; ranked: Entry[]; notRanked: Entry[] }[];
        };
      };
      errors?: { extensions: Record<string, unknown> }[];
    };
  }

  for (const reference of CASES) {
    it(`answers ${reference.name} with one honest outcome per activity per day`, async () => {
      const body = await rank({ location: reference.location, days: 3 });

      expect(body.errors).toBeUndefined();

      const answer = body.data?.rankActivities;

      expect(answer?.days.length).toBeGreaterThan(0);

      for (const day of answer?.days ?? []) {
        const entries = [...day.ranked, ...day.notRanked];

        // Every activity accounted for, exactly once, on every day. An activity
        // that quietly vanishes is the failure a nullable field would hide.
        expect(entries.map((entry) => entry.activity).toSorted()).toEqual(ACTIVITIES);

        for (const entry of day.ranked) {
          expect(entry.outcome.__typename).toBe('RankedOutcome');
          expect(entry.outcome.score).toBeGreaterThanOrEqual(0);
          expect(entry.outcome.score).toBeLessThanOrEqual(100);
        }

        for (const entry of day.notRanked) {
          expect(['NotApplicableOutcome', 'NoDataOutcome']).toContain(entry.outcome.__typename);
          expect(isReasonCode(String(entry.outcome.reason))).toBe(true);
          // A refusal is never a score, and a score is never a refusal.
          expect(entry.outcome.score).toBeUndefined();
        }

        // Descending, so the answer is an ordering and not a list.
        const scores = day.ranked.map((entry) => entry.outcome.score ?? Number.NaN);

        expect(scores).toEqual(scores.toSorted((left, right) => right - left));
      }
    });
  }

  it('ranks surfing at the Atlantic coast, where there is a sea and a recorded swell', async () => {
    const body = await rank({ location: CASES[1].location, days: 1 });
    const day = body.data?.rankActivities.days[0];

    expect(day?.ranked.map((entry) => entry.activity)).toContain('surfing');
  });

  it('never ranks surfing inland, and says which of the two reasons it is', async () => {
    const body = await rank({ location: CASES[0].location, days: 1 });
    const surfing = body.data?.rankActivities.days[0]?.notRanked.find(
      (entry) => entry.activity === 'surfing',
    );

    expect(surfing?.outcome.__typename).not.toBe('RankedOutcome');
    // Which of the two it is on a given day is `04-add-location-applicability`'s
    // question: the first probe honestly answers that coverage is not settled.
    expect(surfing?.outcome.reason).toMatch(/NO_COASTLINE_NEARBY|MARINE_UNAVAILABLE/);
  });

  it('resolves an ambiguous name to the largest place, and says which country it is in', async () => {
    const body = await rank({ location: { name: 'Moscow' }, days: 1 });

    expect(body.errors).toBeUndefined();
    expect(body.data?.rankActivities.location.name).toBe('Moscow');
    expect(body.data?.rankActivities.location.countryCode).toBe('RU');
  });

  it('answers a lookup that returned somebody else HTML with a code and no HTML', async () => {
    // The recorded evidence for "München" is an HTTP 403 carrying an nginx
    // page, so the three-spellings row of section 12 cannot be driven through
    // the API from the fixture set. What can be, and matters more here, is that
    // the page reaches nobody: the response is a registry code and nothing else
    // (spec, "Nothing internal crosses the boundary").
    const body = await rank({ location: { name: 'München' }, days: 1 });
    const wire = JSON.stringify(body);

    expect(body.data?.rankActivities ?? null).toBeNull();
    expect(isReasonCode(String(body.errors?.[0]?.extensions['code']))).toBe(true);
    expect(wire).not.toContain('<html');
    expect(wire).not.toContain('nginx');
  });
});
