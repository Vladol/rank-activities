import { Injectable, type NestMiddleware } from '@nestjs/common';

import { newTraceId, runWithTrace } from './trace-context';

/** The header an edge proxy uses to name a request it has already identified. */
export const TRACE_HEADER = 'x-request-id';

interface Headers {
  readonly [name: string]: string | string[] | undefined;
}

/**
 * Opens the trace scope for one HTTP request, before anything else runs.
 *
 * It is a middleware rather than an interceptor because a request refused by a
 * guard — the inbound rate limit, say — never reaches an interceptor, and a
 * refusal without an identifier is a refusal nobody can look up.
 */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(
    request: { headers?: Headers },
    response: { setHeader?: (name: string, value: string) => void },
    next: () => void,
  ): void {
    const inbound = request.headers?.[TRACE_HEADER];
    const traceId = newTraceId(Array.isArray(inbound) ? inbound[0] : inbound);

    response.setHeader?.(TRACE_HEADER, traceId);
    runWithTrace(traceId, next);
  }
}
