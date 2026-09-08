import { describe, expect, it } from 'vitest';

import { MetricsRegistry } from './metrics.registry';

describe('the metrics registry', () => {
  it('adds up a counter per label set', () => {
    const metrics = new MetricsRegistry();

    metrics.increment('ops', { outcome: 'hit' });
    metrics.increment('ops', { outcome: 'hit' });
    metrics.increment('ops', { outcome: 'miss' });

    expect(metrics.read('ops', { outcome: 'hit' })).toBe(2);
    expect(metrics.read('ops', { outcome: 'miss' })).toBe(1);
  });

  it('does not split a series over the order the labels were written in', () => {
    const metrics = new MetricsRegistry();

    metrics.increment('ops', { a: '1', b: '2' });
    metrics.increment('ops', { b: '2', a: '1' });

    expect(metrics.snapshot()).toHaveLength(1);
    expect(metrics.read('ops', { a: '1', b: '2' })).toBe(2);
  });

  it('lets a gauge fall', () => {
    const metrics = new MetricsRegistry();

    metrics.set('remaining', 10);
    metrics.set('remaining', 4);

    expect(metrics.read('remaining')).toBe(4);
  });

  it('reads an untouched series as zero rather than as absent', () => {
    expect(new MetricsRegistry().read('never_recorded')).toBe(0);
  });
});
