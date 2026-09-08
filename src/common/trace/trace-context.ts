import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * The identifier that ties one answer to the log records made while producing
 * it (ADR 0004).
 *
 * It lives in `AsyncLocalStorage` rather than being threaded through every
 * signature because the things that need it — an exception filter, a response
 * extension, a log record — are not on the call path of the code that produced
 * the failure. Threading it would put a transport concern into the domain,
 * which is the one thing `graphql-api` may not do.
 *
 * It carries no internal detail: it is a random identifier and nothing else, so
 * handing it to a caller tells them only which record to quote when they report
 * a problem (design.md, "Risks", last entry).
 */
export interface TraceContext {
  readonly traceId: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/** A fresh identifier, or the one an edge proxy already assigned this request. */
export function newTraceId(inbound?: string | undefined): string {
  const trimmed = inbound?.trim() ?? '';

  // Bounded and stripped of anything but the characters an identifier is made
  // of: it reaches a log line and a response, and an inbound header is a
  // stranger's string.
  return /^[\w-]{1,64}$/.test(trimmed) ? trimmed : randomUUID();
}

export function runWithTrace<T>(traceId: string, work: () => T): T {
  return storage.run({ traceId }, work);
}

/** The identifier of the request in flight, when there is one. */
export function currentTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}
