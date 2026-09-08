import { type ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { GraphQLError } from 'graphql';

import { REASON, type ReasonCode, type ReasonKind, isReasonCode } from '../../domain/shared/reason-code';
import { currentTraceId, newTraceId } from '../trace/trace-context';
import { DomainFailure } from './domain-failure.error';

/**
 * The one place a failure becomes something a client can see.
 *
 * Two rules, and everything here follows from them. Every code it emits is a
 * code from the reason registry, so a client learns one vocabulary for a
 * refused request and for a refused activity. And nothing else leaves: the
 * message is written here from the reason's kind, never taken from the
 * exception, so a source's own words, an invalid body, a stack or a type name
 * cannot travel out even by accident (spec, "Nothing internal crosses the
 * boundary"). What did happen is in the log record the trace identifier names.
 */
const MESSAGE_BY_KIND: Record<ReasonKind, string> = {
  request: 'the request was refused',
  internal: 'the request could not be completed',
  not_applicable: 'no answer could be produced',
  constraint: 'no answer could be produced',
  no_data: 'no answer could be produced',
};

/** What a caller is told, and all of it: a registry code and a trace identifier. */
export interface TransportErrorExtensions extends Record<string, unknown> {
  readonly code: ReasonCode;
  readonly traceId: string;
}

export function transportMessage(code: ReasonCode): string {
  return `${MESSAGE_BY_KIND[REASON[code].kind]}: ${code}`;
}

/**
 * Which registry code names this exception.
 *
 * Anything not recognised is `INTERNAL_ERROR` rather than its own code: a
 * failure we did not foresee is by definition one we cannot describe honestly,
 * and inventing a code for it would be a guess published as a fact.
 */
export function codeOf(exception: unknown): ReasonCode {
  if (exception instanceof DomainFailure && isReasonCode(exception.failure.code)) {
    return exception.failure.code;
  }

  // The inbound limiter refuses with an HTTP 429 before a resolver is reached.
  if (isTooManyRequests(exception)) {
    return 'RATE_LIMITED';
  }

  return 'INTERNAL_ERROR';
}

@Catch()
export class GraphqlExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Api');

  override catch(exception: unknown, host: ArgumentsHost): unknown {
    if (host.getType<'graphql' | 'http'>() !== 'graphql') {
      // Health probes are ordinary HTTP and answer with status lines, not with
      // an error envelope. Translating them here would make an orchestrator
      // read `200` where it must read `503`.
      return super.catch(exception, host);
    }

    const traceId = currentTraceId() ?? newTraceId();
    const code = codeOf(exception);

    this.log(traceId, code, exception);

    return new GraphQLError(transportMessage(code), {
      extensions: { code, traceId } satisfies TransportErrorExtensions,
    });
  }

  /**
   * The whole of what was hidden, kept.
   *
   * The stack is logged only for what we did not foresee: a refused request is
   * an expected outcome, and a stack per bad postcode buries the one stack that
   * means something.
   */
  private log(traceId: string, code: ReasonCode, exception: unknown): void {
    if (code === 'INTERNAL_ERROR') {
      this.logger.error(
        { traceId, code, detail: detailOf(exception) },
        exception instanceof Error ? exception.stack : undefined,
      );

      return;
    }

    this.logger.warn({ traceId, code, detail: detailOf(exception) });
  }
}

/** What the exception said, for the log and for nowhere else. */
function detailOf(exception: unknown): string {
  if (exception instanceof DomainFailure) {
    const context = exception.failure.context;

    return context === undefined
      ? exception.failure.message
      : `${exception.failure.message} ${JSON.stringify(context)}`;
  }

  if (exception instanceof Error) {
    return `${exception.name}: ${exception.message}`;
  }

  return String(exception);
}

function isTooManyRequests(exception: unknown): boolean {
  const status = (exception as { getStatus?: () => unknown })?.getStatus;

  return typeof status === 'function' && status.call(exception) === 429;
}
