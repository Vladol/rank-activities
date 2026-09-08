import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';

/**
 * Two signals, two questions. That readiness turns red on an unusable store is
 * `test/integration/degradation.spec.ts`, which is the only suite with a store
 * to break; here the concern is that the two are separate and that neither is
 * an opinion about the weather source.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers liveness and readiness at their own addresses', async () => {
    const live = await request(app.getHttpServer()).get('/health/live').expect(200);
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(live.body.status).toBe('ok');
    expect(typeof live.body.uptime).toBe('number');
    expect(ready.body.status).toBe('ready');
  });

  it('offers no third endpoint that means both at once', async () => {
    // A single word for two questions is a word that answers neither: an
    // orchestrator restarts on one signal and drains on the other.
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
