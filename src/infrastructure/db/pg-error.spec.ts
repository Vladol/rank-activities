import { describe, expect, it } from 'vitest';

import { CHECK_VIOLATION, isUnavailable, sqlState } from './pg-error';

/** What Drizzle hands a caller: its own error, with the driver's underneath. */
function wrapped(driver: Record<string, unknown>): Error {
  return Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('detail'), driver) });
}

describe('reading the SQLSTATE off a failed query', () => {
  it('finds it under the wrapper Drizzle puts around it', () => {
    expect(sqlState(wrapped({ code: CHECK_VIOLATION }))).toBe(CHECK_VIOLATION);
  });

  it('answers nothing when the failure carries no state at all', () => {
    expect(sqlState(new Error('socket hang up'))).toBeUndefined();
  });

  it('ignores a `code` that is not a SQLSTATE, such as a Node errno', () => {
    expect(sqlState(wrapped({ code: 'ECONNREFUSED' }))).toBeUndefined();
  });
});

describe('telling an outage from a refusal', () => {
  it('calls a check violation what it is: our own row, not the store being down', () => {
    expect(isUnavailable(wrapped({ code: CHECK_VIOLATION, severity: 'ERROR' }))).toBe(false);
  });

  it('calls anything FATAL an outage, whatever code it carries', () => {
    // A database that has stopped accepting connections answers 55000, which is
    // a generic code; what makes it an outage is that it ended the session.
    expect(isUnavailable(wrapped({ code: '55000', severity: 'FATAL' }))).toBe(true);
  });

  it('calls a connection exception an outage', () => {
    expect(isUnavailable(wrapped({ code: '08006', severity: 'ERROR' }))).toBe(true);
  });

  it('calls a failure that never reached the server an outage', () => {
    expect(isUnavailable(new Error('connect ECONNREFUSED'))).toBe(true);
  });
});
