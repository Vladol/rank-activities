/**
 * The SQLSTATE behind a failed query, or `undefined` when the failure was not
 * the database refusing something.
 *
 * Drizzle wraps a driver error in its own, so the code that matters — the
 * unique violation that means "someone else got there first", the check that
 * means "this row is not a legal row" — is one level down. Unwrapping it in one
 * place keeps every caller from reaching into `cause` and guessing.
 */
export function sqlState(cause: unknown): string | undefined {
  for (let current = cause; current !== null && current !== undefined; ) {
    const code = (current as { code?: unknown }).code;

    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/** A write lost to someone who wrote the same row first. */
export const UNIQUE_VIOLATION = '23505';

/** A row the schema does not consider a legal row. */
export const CHECK_VIOLATION = '23514';

/** A reference to something that is not in the registry it must come from. */
export const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Whether the failure is the store being unreachable rather than the store
 * refusing a write. The distinction is the whole of the degradation table: an
 * outage is degraded through, an illegal row is a fault in our own code that
 * must not be swallowed.
 */
export function isUnavailable(cause: unknown): boolean {
  // FATAL and PANIC end the session rather than the statement, whatever the
  // code says: the backend shutting down, a database that has stopped accepting
  // connections, an exhausted connection slot. None of those are answers about
  // the row that was being written.
  if (severity(cause) === 'FATAL' || severity(cause) === 'PANIC') {
    return true;
  }

  const state = sqlState(cause);

  if (state === undefined) {
    // No SQLSTATE at all: the driver never reached a server to be answered by.
    return true;
  }

  // Class 08 — connection exception; 57P01..57P03 — admin shutdown, crash,
  // cannot connect now; 53300 — too many clients.
  return state.startsWith('08') || state.startsWith('57P') || state === '53300';
}

function severity(cause: unknown): string | undefined {
  for (let current = cause; current !== null && current !== undefined; ) {
    const found = (current as { severity?: unknown }).severity;

    if (typeof found === 'string') {
      return found;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
