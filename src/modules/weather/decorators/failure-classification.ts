import type { WeatherError } from '../ports/contracts';

/**
 * Which failures are worth another attempt, and how long to wait.
 *
 * Kept apart from the wrapper so the two questions it answers can be tested
 * without a timer: what gets retried, and after how long. A retry policy whose
 * jitter can only be observed by waiting is a policy nobody checks.
 */

const SERVER_FAULT = 500;

/**
 * A failure the source may not repeat. Everything else — a malformed body, a
 * schema that does not match, a status the contract rejects for our own
 * reasons — will answer the same way to the same question, and repeating it
 * spends quota to learn nothing (ADR 0006).
 */
export function isRetryableFailure(error: WeatherError): boolean {
  switch (error.code) {
    case 'TRANSPORT_FAILURE':
    case 'TIMEOUT':
      return true;
    case 'UNEXPECTED_STATUS':
      return error.context?.rateLimited === true || statusOf(error) >= SERVER_FAULT;
    default:
      return false;
  }
}

/**
 * A failure that says something about the source rather than about our
 * request. It is what the breaker counts: a rejected horizon is our own bug
 * and must not cut a working source off.
 */
export function isSourceFault(error: WeatherError): boolean {
  switch (error.code) {
    case 'TRANSPORT_FAILURE':
    case 'TIMEOUT':
    case 'MALFORMED_BODY':
    case 'SCHEMA_MISMATCH':
    case 'UNEXPECTED_CONTENT_TYPE':
      return true;
    case 'UNEXPECTED_STATUS':
      return error.context?.rateLimited === true || statusOf(error) >= SERVER_FAULT;
    default:
      return false;
  }
}

export interface BackoffOptions {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** Injected so the jitter is a property of the policy rather than of the run. */
  readonly random?: () => number;
}

/**
 * How long to wait before attempt number `attempt` (the first retry is 1).
 *
 * Exponential with full jitter, so a wave of clients that failed together does
 * not return together. A delay the source itself stated wins outright: it
 * knows when it will answer again, and guessing shorter is how a rate limit
 * becomes a ban (stage-three.md, section 7.4).
 */
export function retryDelayMs(
  attempt: number,
  error: WeatherError | undefined,
  options: BackoffOptions,
): number {
  const stated = error?.context?.retryAfterSeconds;

  if (typeof stated === 'number' && stated >= 0) {
    return Math.min(stated * 1_000, options.maxDelayMs);
  }

  const random = options.random ?? Math.random;
  const ceiling = Math.min(options.initialDelayMs * 2 ** Math.max(0, attempt - 1), options.maxDelayMs);

  return Math.round(random() * ceiling);
}

/** The exponential ceiling, without the jitter: what the delay grows towards. */
export function backoffCeilingMs(attempt: number, options: BackoffOptions): number {
  return Math.min(options.initialDelayMs * 2 ** Math.max(0, attempt - 1), options.maxDelayMs);
}

function statusOf(error: WeatherError): number {
  const status = error.context?.status;

  return typeof status === 'number' ? status : 0;
}
