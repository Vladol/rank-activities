import { describe, expect, it } from 'vitest';

import { domainError } from '../../../domain/shared/domain-error';
import type { WeatherError } from '../ports/contracts';
import {
  backoffCeilingMs,
  isRetryableFailure,
  isSourceFault,
  retryDelayMs,
} from './failure-classification';

const status = (code: number, extra: Record<string, string | number | boolean> = {}): WeatherError =>
  domainError('UNEXPECTED_STATUS', 'the source refused the request', { status: code, ...extra });

describe('only failures worth retrying are retried', () => {
  it('retries a network fault and a timeout', () => {
    expect(isRetryableFailure(domainError('TRANSPORT_FAILURE', 'never completed'))).toBe(true);
    expect(isRetryableFailure(domainError('TIMEOUT', 'no answer in the budget'))).toBe(true);
  });

  it('retries a server fault and a rate limit', () => {
    expect(isRetryableFailure(status(503))).toBe(true);
    expect(isRetryableFailure(status(429, { rateLimited: true }))).toBe(true);
  });

  it('does not retry a rejection that repeating cannot fix', () => {
    expect(isRetryableFailure(status(400))).toBe(false);
    expect(isRetryableFailure(status(404))).toBe(false);
    expect(isRetryableFailure(domainError('SCHEMA_MISMATCH', 'units differ'))).toBe(false);
    expect(isRetryableFailure(domainError('MALFORMED_BODY', 'empty body'))).toBe(false);
    expect(isRetryableFailure(domainError('HORIZON_TOO_LARGE', 'too many days'))).toBe(false);
    // Our own budget: another attempt would find it just as empty.
    expect(isRetryableFailure(domainError('PROVIDER_BUSY', 'no budget left'))).toBe(false);
  });
});

describe('what the breaker counts', () => {
  it('counts what the source did wrong', () => {
    expect(isSourceFault(domainError('TRANSPORT_FAILURE', 'never completed'))).toBe(true);
    expect(isSourceFault(domainError('SCHEMA_MISMATCH', 'units differ'))).toBe(true);
    expect(isSourceFault(status(500))).toBe(true);
  });

  it('does not count what we did wrong', () => {
    // A rejected horizon is our bug; cutting the source off for it would take
    // a working source down over a request nobody should have made.
    expect(isSourceFault(domainError('HORIZON_TOO_LARGE', 'too many days'))).toBe(false);
    expect(isSourceFault(status(400))).toBe(false);
    expect(isSourceFault(domainError('PROVIDER_BUSY', 'no budget left'))).toBe(false);
  });
});

describe('the delay before another attempt', () => {
  const options = { initialDelayMs: 100, maxDelayMs: 5_000 };

  it('grows with each attempt', () => {
    expect(backoffCeilingMs(1, options)).toBe(100);
    expect(backoffCeilingMs(2, options)).toBe(200);
    expect(backoffCeilingMs(3, options)).toBe(400);
  });

  it('stops growing at the ceiling', () => {
    expect(backoffCeilingMs(20, options)).toBe(5_000);
  });

  it('is jittered across the whole interval', () => {
    // A wave of clients that failed together must not return together.
    expect(retryDelayMs(3, undefined, { ...options, random: () => 0 })).toBe(0);
    expect(retryDelayMs(3, undefined, { ...options, random: () => 1 })).toBe(400);
    expect(retryDelayMs(3, undefined, { ...options, random: () => 0.5 })).toBe(200);
  });

  it('honours a delay the source stated over its own backoff', () => {
    const limited = status(429, { rateLimited: true, retryAfterSeconds: 2 });

    expect(retryDelayMs(1, limited, { ...options, random: () => 1 })).toBe(2_000);
  });

  it('does not wait longer than the ceiling even when told to', () => {
    const limited = status(429, { rateLimited: true, retryAfterSeconds: 3_600 });

    expect(retryDelayMs(1, limited, options)).toBe(5_000);
  });
});
