import { describe, expect, it } from 'vitest';

import { type Result, err, isErr, isOk, map, mapErr, ok, unwrapOr } from './result';

describe('Result', () => {
  it('carries the value of a success', () => {
    const result = ok(42);

    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(result.ok ? result.value : undefined).toBe(42);
  });

  it('carries the error of a failure instead of losing it', () => {
    const failure = err({ code: 'TIMEOUT' as const });

    expect(isErr(failure)).toBe(true);
    expect(failure.ok ? undefined : failure.error).toEqual({ code: 'TIMEOUT' });
  });

  it('narrows the union through the ok discriminant', () => {
    const results: Result<number, string>[] = [ok(1), err('boom')];

    // The point of the discriminant: no cast is needed to reach either side.
    expect(results.map((result) => (result.ok ? result.value + 1 : result.error.length))).toEqual([
      2, 4,
    ]);
  });

  describe('helpers never throw', () => {
    it('map leaves a failure untouched and never calls the mapper', () => {
      let calls = 0;
      const mapped = map(err<string>('boom'), (n: number) => {
        calls += 1;
        return n * 2;
      });

      expect(calls).toBe(0);
      expect(mapped).toEqual({ ok: false, error: 'boom' });
    });

    it('map transforms the value of a success', () => {
      expect(map(ok(21), (n: number) => n * 2)).toEqual({ ok: true, value: 42 });
    });

    it('mapErr leaves a success untouched and never calls the mapper', () => {
      let calls = 0;
      const mapped = mapErr(ok(1), (e: string) => {
        calls += 1;
        return e.length;
      });

      expect(calls).toBe(0);
      expect(mapped).toEqual({ ok: true, value: 1 });
    });

    it('mapErr transforms the error of a failure', () => {
      expect(mapErr(err('boom'), (e: string) => e.length)).toEqual({ ok: false, error: 4 });
    });

    it('unwrapOr returns the fallback for a failure rather than throwing', () => {
      expect(() => unwrapOr(err('boom'), 7)).not.toThrow();
      expect(unwrapOr(err<string>('boom'), 7)).toBe(7);
      expect(unwrapOr(ok(1), 7)).toBe(1);
    });
  });
});
