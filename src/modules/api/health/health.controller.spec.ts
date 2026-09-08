import { describe, expect, it } from 'vitest';

import type { Database } from '../../../infrastructure/db/database';
import type { SchemaGuardService } from '../../../infrastructure/db/schema-guard.service';
import type { SchemaState } from '../../../infrastructure/db/migration-guard';
import { HealthController, type Readiness } from './health.controller';

function controllerFor(state: SchemaState, db: Database | undefined): HealthController {
  return new HealthController(
    { state: async () => state } as unknown as SchemaGuardService,
    db,
  );
}

const A_STORE = {} as Database;

async function readiness(controller: HealthController): Promise<{
  status: number;
  body: Readiness;
}> {
  try {
    return { status: 200, body: await controller.ready() };
  } catch (thrown) {
    const failure = thrown as { getStatus: () => number; getResponse: () => Readiness };

    return { status: failure.getStatus(), body: failure.getResponse() };
  }
}

describe('the two health signals', () => {
  it('reports the process alive without asking anything of the store', () => {
    // No store, and still alive: a liveness probe that went red because a
    // dependency is down would ask the orchestrator to restart a healthy
    // process (ADR 0004).
    const live = controllerFor({ kind: 'unreachable', message: 'no route' }, A_STORE).live();

    expect(live.status).toBe('ok');
    expect(typeof live.uptime).toBe('number');
  });

  it('is ready when the store answers at the schema this build expects', async () => {
    const answer = await readiness(controllerFor({ kind: 'at_head', head: '0007_reason_kinds' }, A_STORE));

    expect(answer).toEqual({ status: 200, body: { status: 'ready', store: 'at_head' } });
  });

  it('is not ready, with a 503, when the store cannot be reached', async () => {
    const answer = await readiness(
      controllerFor({ kind: 'unreachable', message: 'no route to host' }, A_STORE),
    );

    expect(answer.status).toBe(503);
    expect(answer.body.status).toBe('not_ready');
    expect(answer.body.store).toBe('unreachable');
  });

  it('is not ready when the schema is not the one this build was written against', async () => {
    const answer = await readiness(
      controllerFor(
        {
          kind: 'mismatch',
          expected: ['0007_reason_kinds'],
          found: [],
          message: 'the store is behind: expected 0007_reason_kinds',
        },
        A_STORE,
      ),
    );

    expect(answer.status).toBe(503);
    expect(answer.body.store).toBe('schema_mismatch');
    expect(answer.body.detail).toContain('0007_reason_kinds');
  });

  it('is ready with no store configured, because that is a stated mode', async () => {
    const answer = await readiness(
      controllerFor({ kind: 'unreachable', message: 'DATABASE_URL is unset' }, undefined),
    );

    expect(answer).toEqual({ status: 200, body: { status: 'ready', store: 'not_configured' } });
  });
});
