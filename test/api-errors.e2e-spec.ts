import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { domainError } from '../src/domain/shared/domain-error';
import { REASON, isReasonCode } from '../src/domain/shared/reason-code';
import { err } from '../src/domain/shared/result';
import type { PlaceLookupPort } from '../src/modules/weather/ports/place-lookup.port';
import {
  ARCHIVE_PORT,
  FORECAST_PORT,
  MARINE_PORT,
  PLACE_LOOKUP_PORT,
} from '../src/modules/weather/ports/tokens';
import { stubPort } from './support/stub-series-port';

const LISBON = { latitude: 38.7167, longitude: -9.1333 };

/**
 * The text Open-Meteo actually answered with when asked for a variable that
 * does not exist, recorded in stage 3. It names an internal Swift type of the
 * vendor's implementation, which is exactly the kind of thing that must reach
 * the log and never the caller (spec, "Nothing internal crosses the boundary").
 */
const RECORDED_VENDOR_TEXT = (
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'docs/investigation/open-meteo/samples/error-bad-variable.json'),
      'utf8',
    ),
  ) as { reason: string }
).reason;

/** Everything the application wrote while a test ran, in the order it wrote it. */
class RecordingLogger implements LoggerService {
  readonly records: unknown[][] = [];

  log(...args: unknown[]): void {
    this.records.push(args);
  }

  error(...args: unknown[]): void {
    this.records.push(args);
  }

  warn(...args: unknown[]): void {
    this.records.push(args);
  }

  debug(...args: unknown[]): void {
    this.records.push(args);
  }

  verbose(...args: unknown[]): void {
    this.records.push(args);
  }

  written(): string {
    return JSON.stringify(this.records);
  }
}

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function applicationWith(
  overrides: readonly (readonly [symbol, unknown])[],
): Promise<{ app: INestApplication; logger: RecordingLogger }> {
  let builder = Test.createTestingModule({ imports: [AppModule] });

  for (const [token, value] of overrides) {
    builder = builder.overrideProvider(token).useValue(value);
  }

  const created = (await builder.compile()).createNestApplication();
  const logger = new RecordingLogger();

  created.useLogger(logger);
  await created.init();
  app = created;

  return { app: created, logger };
}

async function rank(instance: INestApplication, input: Record<string, unknown>) {
  const response = await request(instance.getHttpServer())
    .post('/graphql')
    .send({
      query: `query R($i: RankingInput!) {
        rankActivities(input: $i) {
          stale
          days { ranked { activity } notRanked { activity outcome { __typename
            ... on NoDataOutcome { reason retryable }
            ... on NotApplicableOutcome { reason } } } }
          undated { activity outcome { __typename ... on NoDataOutcome { reason retryable } } }
        }
      }`,
      variables: { i: input },
    });

  return response.body as {
    data?: { rankActivities?: Record<string, unknown> };
    errors?: { message: string; extensions: Record<string, unknown> }[];
    extensions?: Record<string, unknown>;
  };
}

describe('What a failure is allowed to say (e2e)', () => {
  it('keeps a source own words in the log and answers with a code and an identifier', async () => {
    // The lookup throws rather than answering, which is the one thing a port
    // is not allowed to do — so it stands in for every failure we did not
    // foresee, with a real vendor's text attached.
    const throwing: PlaceLookupPort = {
      sourceId: 'throwing-lookup',
      lookup: () => {
        throw new Error(RECORDED_VENDOR_TEXT);
      },
    };
    const { app: instance, logger } = await applicationWith([[PLACE_LOOKUP_PORT, throwing]]);
    const body = await rank(instance, { location: { name: 'Lisbon' } });
    const error = body.errors?.[0];

    expect(error?.extensions['code']).toBe('INTERNAL_ERROR');
    expect(String(error?.extensions['traceId'])).toMatch(/^[\w-]+$/);

    const wire = JSON.stringify(body);

    expect(wire).not.toContain(RECORDED_VENDOR_TEXT);
    expect(wire).not.toContain('SurfacePressureAndHeightVariable');
    expect(wire).not.toContain('stack');
    expect(wire).not.toContain('Error:');

    // Kept, not discarded: the operator needs exactly what the caller must not
    // be given.
    expect(logger.written()).toContain('SurfacePressureAndHeightVariable');
  });

  it('ties the answer to the record with one identifier', async () => {
    const failing: PlaceLookupPort = {
      sourceId: 'failing-lookup',
      lookup: async () => err(domainError('TRANSPORT_FAILURE', RECORDED_VENDOR_TEXT)),
    };
    const { app: instance, logger } = await applicationWith([[PLACE_LOOKUP_PORT, failing]]);
    const body = await rank(instance, { location: { name: 'Lisbon' } });
    const traceId = String(body.errors?.[0]?.extensions['traceId']);

    expect(traceId).toMatch(/^[\w-]+$/);
    // The same identifier, on the wire and in the record. Without it a user can
    // report a problem no operator can find.
    expect(logger.written()).toContain(traceId);
  });

  it('answers with a registry code whatever the failure was', async () => {
    const failing: PlaceLookupPort = {
      sourceId: 'failing-lookup',
      lookup: async () => err(domainError('TRANSPORT_FAILURE', 'no route to host')),
    };
    const { app: instance } = await applicationWith([[PLACE_LOOKUP_PORT, failing]]);
    const body = await rank(instance, { location: { name: 'Lisbon' } });
    const code = String(body.errors?.[0]?.extensions['code']);

    expect(isReasonCode(code)).toBe(true);
    expect(REASON[code as keyof typeof REASON].kind).toBeDefined();
  });
});

describe('When every weather source is down (e2e)', () => {
  const down = (capability: 'forecast' | 'marine' | 'archive') =>
    stubPort(capability, {
      answer: async () => err(domainError('TRANSPORT_FAILURE', RECORDED_VENDOR_TEXT)),
    });

  it('stays ready, and answers with missing data rather than with nothing', async () => {
    const { app: instance } = await applicationWith([
      [FORECAST_PORT, down('forecast')],
      [MARINE_PORT, down('marine')],
      [ARCHIVE_PORT, down('archive')],
    ]);

    // A source outage must not take the instance out of rotation: one that can
    // still answer from cached data, marked stale, would answer nothing at all
    // (design.md, Decision 7).
    const ready = await request(instance.getHttpServer()).get('/health/ready').expect(200);

    expect(ready.body.status).toBe('ready');

    const body = await rank(instance, { location: LISBON, days: 2 });
    const answer = body.data?.rankActivities as
      | {
          days: { notRanked: { outcome: { __typename: string; reason?: string } }[] }[];
          undated: { outcome: { __typename: string; reason?: string; retryable?: boolean } }[];
        }
      | undefined;

    expect(body.errors).toBeUndefined();
    expect(answer).toBeDefined();

    const outcomes = [
      ...(answer?.undated ?? []),
      ...(answer?.days ?? []).flatMap((day) => day.notRanked),
    ];

    expect(outcomes.length).toBeGreaterThan(0);

    for (const entry of outcomes) {
      expect(entry.outcome.__typename).not.toBe('RankedOutcome');
      expect(isReasonCode(String(entry.outcome.reason))).toBe(true);
    }

    expect(JSON.stringify(body)).not.toContain(RECORDED_VENDOR_TEXT);
  });
});
