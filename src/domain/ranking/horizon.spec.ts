import { describe, expect, it } from 'vitest';

import { resolveHorizon } from './horizon';

const LIMITS = { defaultDays: 7, maxDays: 7 };

describe('deciding the horizon', () => {
  it('honours a horizon within range', () => {
    expect(resolveHorizon(3, LIMITS)).toEqual({ ok: true, value: 3 });
  });

  it('uses the configured default when none is given', () => {
    expect(resolveHorizon(undefined, { defaultDays: 5, maxDays: 7 })).toEqual({
      ok: true,
      value: 5,
    });
  });

  it('refuses an excessive horizon rather than shortening it', () => {
    const refused = resolveHorizon(10, LIMITS);

    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error.code).toBe('HORIZON_TOO_LARGE');
    expect(refused.ok ? undefined : refused.error.context).toMatchObject({
      requested: 10,
      allowed: 7,
    });
  });

  it('refuses a horizon that is not a whole number of days, or is under one', () => {
    for (const bad of [0, -1, 2.5]) {
      expect(resolveHorizon(bad, LIMITS).ok).toBe(false);
    }
  });

  it('accepts the boundary itself', () => {
    expect(resolveHorizon(7, LIMITS)).toEqual({ ok: true, value: 7 });
  });
});
