import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';

describe('GraphQL (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers the hello query, and carries the trace identifier with it', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ hello }' })
      .expect(200);

    expect(response.body.data).toEqual({ hello: 'Hello World!' });
    // Every response, not only a failed one: an answer that turns out to be
    // wrong is the defect this service is most likely to have, and a user
    // cannot report one they cannot name (spec, "One identifier ties an answer
    // to its record").
    expect(response.body.extensions.traceId).toMatch(/^[\w-]+$/);
  });
});
