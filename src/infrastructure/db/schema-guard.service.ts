import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { DATABASE, type Database } from './database';
import { type SchemaState, inspectSchema } from './migration-guard';

/**
 * Raised when the schema in front of the service is not the one this build was
 * written against. It is fatal by design: a service that serves requests
 * against a schema it does not recognise answers them wrongly, and a startup
 * failure naming both states is cheaper than finding out from the data
 * (ADR 0003).
 */
export class SchemaOutOfDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaOutOfDateError';
  }
}

/**
 * The startup check, and the only thing in the service that looks at the
 * migration state.
 *
 * It reads. It never writes: migration is a deploy step, so several instances
 * starting at once perform no schema change between them, and a failed
 * migration is a failed deploy rather than a crash loop across every pod
 * (design.md, Decision 6).
 */
@Injectable()
export class SchemaGuardService {
  private readonly logger = new Logger(SchemaGuardService.name);

  constructor(@Optional() @Inject(DATABASE) private readonly db: Database | undefined) {}

  /** The state as it is now. Readiness asks this on every check. */
  async state(): Promise<SchemaState> {
    if (this.db === undefined) {
      return { kind: 'unreachable', message: 'DATABASE_URL is unset; this build runs with no store.' };
    }

    return inspectSchema(this.db);
  }

  /**
   * Throws when the schema is behind or ahead of the code, and returns when it
   * is at head or when there is no store to check.
   *
   * An unreachable store does not stop the start: not knowing the schema is an
   * outage, which the service is required to degrade through, and treating it
   * as a mismatch would turn every database blip into a refusal to boot
   * (spec, "An unavailable store degrades named capabilities only").
   */
  async verify(): Promise<SchemaState> {
    if (this.db === undefined) {
      // Not a fault and not an outage: running without a store is a stated mode
      // with a stated degradation, and `DatabaseModule` has already said so.
      return this.state();
    }

    const state = await this.state();

    if (state.kind === 'mismatch') {
      throw new SchemaOutOfDateError(state.message);
    }

    if (state.kind === 'unreachable') {
      this.logger.error(
        `The store did not answer the schema check: ${state.message}. Starting anyway; readiness ` +
          'stays red until it does.',
      );
    } else {
      this.logger.log(`Schema is at head (${state.head}).`);
    }

    return state;
  }
}
