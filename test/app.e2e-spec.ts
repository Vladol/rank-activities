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

  it('answers the hello query', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ hello }' })
      .expect(200);

    expect(response.body).toEqual({ data: { hello: 'Hello World!' } });
  });
});
