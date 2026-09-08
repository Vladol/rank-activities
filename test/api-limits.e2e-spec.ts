import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService } from '@nestjs/config';

import { AppModule } from '../src/app.module';
import { configurationWith } from './support/environment';
import {
  ARCHIVE_PORT,
  FORECAST_PORT,
  MARINE_PORT,
} from '../src/modules/weather/ports/tokens';
import { stubPort, type StubSeriesPort } from './support/stub-series-port';

const LISBON = { latitude: 38.7167, longitude: -9.1333 };
const RANK = `query R($i: RankingInput!) {
  rankActivities(input: $i) { days { ranked { activity outcome { __typename } } } }
}`;

/**
 * The bounds on the endpoint, exercised by tightening them until a legitimate
 * query crosses one. Testing them at their configured values would need a
 * query the schema cannot express and a flood the suite cannot afford; testing
 * the bound itself is the same behaviour at a size a test can hold.
 */
async function applicationWith(
  env: Record<string, string>,
  ports?: readonly StubSeriesPort<never>[],
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(configurationWith(env));

  for (const [token, port] of [
    [FORECAST_PORT, ports?.[0]],
    [MARINE_PORT, ports?.[1]],
    [ARCHIVE_PORT, ports?.[2]],
  ] as const) {
    if (port !== undefined) {
      builder = builder.overrideProvider(token).useValue(port);
    }
  }

  const app = (await builder.compile()).createNestApplication();

  await app.init();

  return app;
}

describe('The depth limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await applicationWith({ GRAPHQL_MAX_DEPTH: '3' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses a query deeper than the limit, before it is executed', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: RANK, variables: { i: { location: LISBON, days: 1 } } });

    expect(response.body.data).toBeFalsy();
    expect(response.body.errors[0].extensions.code).toBe('INVALID_QUERY');
    expect(response.body.errors[0].message).toContain('3 levels deep');
  });

  it('answers a query within the limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { days { date } } }',
        variables: { i: { location: LISBON, days: 1 } },
      });

    expect(response.body.errors).toBeUndefined();
  });

  it('counts a fragment as a way of writing a selection, not as a step in the data', async () => {
    // The same three levels, spelled through a fragment. Charging a level for
    // the fragment would refuse a query that asks for nothing more.
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query R($i: RankingInput!) {
          rankActivities(input: $i) { days { ...dates } }
        }
        fragment dates on RankedDay { date complete }`,
        variables: { i: { location: LISBON, days: 1 } },
      });

    expect(response.body.errors).toBeUndefined();
  });
});

describe('The inbound limit', () => {
  let app: INestApplication;
  let forecast: StubSeriesPort<never>;

  beforeAll(async () => {
    forecast = stubPort('forecast') as unknown as StubSeriesPort<never>;
    app = await applicationWith(
      { INBOUND_RATE_LIMIT: '1', INBOUND_RATE_WINDOW_SECONDS: '60' },
      [forecast],
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    (forecast.requests as unknown[]).length = 0;
  });

  async function rank() {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: 'query R($i: RankingInput!) { rankActivities(input: $i) { requestedDays } }',
        variables: { i: { location: LISBON, days: 1 } },
      });
  }

  it('refuses the excess, and refuses it before any outbound call is made', async () => {
    const first = await rank();

    expect(first.body.errors).toBeUndefined();

    const outboundAfterFirst = forecast.requests.length;
    const second = await rank();

    expect(second.body.errors[0].extensions.code).toBe('RATE_LIMITED');
    expect(second.body.errors[0].extensions.traceId).toMatch(/^[\w-]+$/);
    // The whole purpose: a flood of invented city names must cost the source
    // nothing (stage-six.md, section 5.4).
    expect(forecast.requests).toHaveLength(outboundAfterFirst);
  });

  it('leaves the health probes alone, however often they are asked', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    }
  });
});

describe('Introspection', () => {
  const INTROSPECT = '{ __schema { queryType { name } } }';

  it('answers outside production, where the schema is a development tool', async () => {
    const app = await applicationWith({ NODE_ENV: 'test' });

    try {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: INTROSPECT });

      expect(response.body.data['__schema'].queryType.name).toBe('Query');
    } finally {
      await app.close();
    }
  });

  it('is refused in production, where the schema is read from the repository', async () => {
    const app = await applicationWith({ NODE_ENV: 'production' });

    try {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: INTROSPECT });

      expect(response.body.data).toBeFalsy();
      expect(response.body.errors[0].extensions.code).toBe('INVALID_QUERY');
    } finally {
      await app.close();
    }
  });
});
