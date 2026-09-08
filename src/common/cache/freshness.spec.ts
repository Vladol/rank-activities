import { describe, expect, it } from 'vitest';

import { expiresAt, freshUntil } from './freshness';

const HOUR = 3_600_000;

describe('freshness ends on the interval boundary', () => {
  it('expires at the next boundary, whenever within the interval it was obtained', () => {
    const early = freshUntil(Date.parse('2026-03-01T10:00:30Z'), 3_600);
    const late = freshUntil(Date.parse('2026-03-01T10:59:00Z'), 3_600);

    expect(early).toBe(late);
    expect(new Date(early).toISOString()).toBe('2026-03-01T11:00:00.000Z');
  });

  it('gives a value obtained exactly on a boundary the whole interval', () => {
    const at = Date.parse('2026-03-01T10:00:00Z');

    expect(freshUntil(at, 3_600) - at).toBe(HOUR);
  });

  it('follows the configured interval rather than the hour', () => {
    // Archive data changes daily; expiring it hourly would spend the quota on
    // a value that could not have changed.
    expect(new Date(freshUntil(Date.parse('2026-03-01T10:00:30Z'), 86_400)).toISOString()).toBe(
      '2026-03-02T00:00:00.000Z',
    );
  });
});

describe('the staleness limit is an age, not another interval', () => {
  it('counts from the moment the value was obtained', () => {
    const obtained = Date.parse('2026-03-01T10:30:00Z');

    expect(expiresAt(obtained, { ttlSeconds: 3_600, maxStaleSeconds: 10_800 })).toBe(
      obtained + 3 * HOUR,
    );
  });
});
