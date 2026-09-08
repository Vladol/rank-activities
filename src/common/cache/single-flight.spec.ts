import { describe, expect, it, vi } from 'vitest';

import { SingleFlight } from './single-flight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

describe('simultaneous misses produce one call', () => {
  it('calls once and answers everyone from it', async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    const work = vi.fn(() => gate.promise);

    const waiters = [flight.run('k', work), flight.run('k', work), flight.run('k', work)];

    expect(work).toHaveBeenCalledTimes(1);
    gate.resolve('answer');

    expect(await Promise.all(waiters)).toEqual(['answer', 'answer', 'answer']);
  });

  it('counts the joins, which is what tells a scattered key from a busy one', async () => {
    const joins = vi.fn();
    const flight = new SingleFlight<string>(joins);
    const gate = deferred<string>();

    const waiters = [flight.run('k', () => gate.promise), flight.run('k', () => gate.promise)];

    gate.resolve('answer');
    await Promise.all(waiters);

    expect(joins).toHaveBeenCalledTimes(1);
  });

  it('gives every waiter the same failure and lets none of them retry', async () => {
    const flight = new SingleFlight<{ ok: false; error: string }>();
    const gate = deferred<{ ok: false; error: string }>();
    const work = vi.fn(() => gate.promise);

    const waiters = [flight.run('k', work), flight.run('k', work)];

    gate.resolve({ ok: false, error: 'the source did not answer' });
    const settled = await Promise.all(waiters);

    expect(work).toHaveBeenCalledTimes(1);
    expect(settled[0]).toBe(settled[1]);
  });

  it('does not hold a key after the call settles', async () => {
    const flight = new SingleFlight<number>();

    await flight.run('k', () => Promise.resolve(1));

    expect(flight.inFlight).toBe(0);
    expect(await flight.run('k', () => Promise.resolve(2))).toBe(2);
  });

  it('releases a key even when the work throws synchronously', async () => {
    const flight = new SingleFlight<number>();

    await expect(
      flight.run('k', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(flight.inFlight).toBe(0);
  });

  it('keeps two keys apart', async () => {
    const flight = new SingleFlight<string>();
    const work = vi.fn(async (value: string) => value);

    await Promise.all([flight.run('a', () => work('a')), flight.run('b', () => work('b'))]);

    expect(work).toHaveBeenCalledTimes(2);
  });
});
