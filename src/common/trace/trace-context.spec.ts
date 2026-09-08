import { describe, expect, it } from 'vitest';

import { currentTraceId, newTraceId, runWithTrace } from './trace-context';

describe('the trace identifier', () => {
  it('is a fresh one when nothing upstream named the request', () => {
    expect(newTraceId()).not.toBe(newTraceId());
    expect(newTraceId(undefined)).toMatch(/^[\w-]+$/);
  });

  it('keeps the identifier an edge proxy already assigned', () => {
    expect(newTraceId('edge-42')).toBe('edge-42');
  });

  it('refuses an inbound value that is not one, rather than echoing it', () => {
    // It reaches a log line and a response, and an inbound header is a
    // stranger's string.
    expect(newTraceId('   ')).not.toBe('   ');
    expect(newTraceId('a b')).not.toBe('a b');
    expect(newTraceId('x'.repeat(200))).toHaveLength(36);
  });

  it('is visible to everything that runs inside the scope, and to nothing outside it', () => {
    expect(currentTraceId()).toBeUndefined();

    runWithTrace('trace-1', () => {
      expect(currentTraceId()).toBe('trace-1');
      runWithTrace('trace-2', () => expect(currentTraceId()).toBe('trace-2'));
      expect(currentTraceId()).toBe('trace-1');
    });

    expect(currentTraceId()).toBeUndefined();
  });

  it('survives an await, which is the whole reason it is not a parameter', async () => {
    await runWithTrace('trace-async', async () => {
      await Promise.resolve();

      expect(currentTraceId()).toBe('trace-async');
    });
  });
});
