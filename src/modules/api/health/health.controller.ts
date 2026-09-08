import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { SchemaGuardService } from '../../../infrastructure/db/schema-guard.service';
import { DATABASE, type Database } from '../../../infrastructure/db/database';

/** What the store looks like from here, in the three states an operator acts on. */
export type StoreStatus = 'at_head' | 'unreachable' | 'schema_mismatch' | 'not_configured';

export interface Liveness {
  readonly status: 'ok';
  readonly uptime: number;
}

export interface Readiness {
  readonly status: 'ready' | 'not_ready';
  readonly store: StoreStatus;
  readonly detail?: string;
}

/**
 * Two signals, two endpoints, two questions.
 *
 * There is deliberately no third endpoint answering "healthy": an orchestrator
 * asks one of these two, and a single word that means both is a word that means
 * neither (spec, "Liveness and readiness answer different questions").
 *
 * Neither is throttled. A probe runs on a schedule, from the orchestrator's own
 * address, and a limiter that refused it would take a healthy instance out of
 * rotation for being probed.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly schema: SchemaGuardService,
    @Inject(DATABASE) private readonly db: Database | undefined,
  ) {}

  /**
   * Whether the process is alive, and nothing else.
   *
   * Deliberately independent of the weather source and of the store: a liveness
   * probe that turns red when a third party is down asks the orchestrator to
   * restart a healthy process, which turns someone else's outage into ours
   * (ADR 0004).
   */
  @Get('live')
  live(): Liveness {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /**
   * Whether this instance should be given traffic.
   *
   * Red when a store is configured and either does not answer or answers with a
   * schema this build does not recognise. A build with no `DATABASE_URL` at all
   * is a different case and reports ready: running without a store is a stated
   * mode with a stated degradation, not a broken deploy
   * (`data-persistence` design.md, Decision 2).
   *
   * The weather source is in neither signal. A source outage would otherwise
   * empty the rotation, so a service that could still answer from cached data
   * and mark it stale would answer nothing at all (design.md, Decision 7).
   */
  @Get('ready')
  async ready(): Promise<Readiness> {
    if (this.db === undefined) {
      return { status: 'ready', store: 'not_configured' };
    }

    const state = await this.schema.state();

    if (state.kind === 'at_head') {
      return { status: 'ready', store: 'at_head' };
    }

    // 503, not a 200 carrying the word "not_ready". An orchestrator reads the
    // status line and nothing else, so a readiness probe that always answers
    // 200 is a readiness probe that is always green — which would make the
    // degradation table a promise the wire never keeps.
    throw new HttpException(
      {
        status: 'not_ready',
        store: state.kind === 'unreachable' ? 'unreachable' : 'schema_mismatch',
        detail: state.message,
      } satisfies Readiness,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
