import { describe, expect, it } from 'vitest';

import { TokenBucket } from './token-bucket';

const MINUTE = 60_000;

describe('the token bucket', () => {
  it('starts full and empties one unit at a time', () => {
    let now = 0;
    const bucket = new TokenBucket(3, MINUTE, () => now);

    expect(bucket.remaining).toBe(3);
    expect([bucket.tryConsume(), bucket.tryConsume(), bucket.tryConsume()]).toEqual([
      true,
      true,
      true,
    ]);
    expect(bucket.tryConsume()).toBe(false);
    expect(bucket.remaining).toBe(0);
  });

  it('refills at the rate the limit states, not at the end of a window', () => {
    let now = 0;
    const bucket = new TokenBucket(600, MINUTE, () => now);

    for (let index = 0; index < 600; index += 1) {
      bucket.tryConsume();
    }

    now += MINUTE / 2;

    // Half a window in: half the limit is back, rather than nothing until the
    // window turns over and then all of it.
    expect(bucket.remaining).toBe(300);
  });

  it('never holds more than its capacity, however long it was idle', () => {
    let now = 0;
    const bucket = new TokenBucket(10, MINUTE, () => now);

    now += 10 * MINUTE;

    expect(bucket.remaining).toBe(10);
  });

  it('takes all the units it was asked for or none of them', () => {
    let now = 0;
    const bucket = new TokenBucket(3, MINUTE, () => now);

    expect(bucket.tryConsume(5)).toBe(false);
    expect(bucket.remaining).toBe(3);
    expect(bucket.tryConsume(3)).toBe(true);
  });
});
