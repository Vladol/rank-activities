import { describe, expect, it } from 'vitest';

import { METRIC, MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { OutboundBudgetService } from './outbound-budget.service';

const LIMITS = { minute: 600, hour: 5_000, day: 10_000 };

function budget(limits = LIMITS) {
  let now = 0;
  const metrics = new MetricsRegistry();
  const service = new OutboundBudgetService({ limits, now: () => now, metrics });

  return {
    service,
    metrics,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe('the outbound budget counts attempts', () => {
  it('spends one unit of every window per attempt', () => {
    const { service } = budget();

    service.tryConsume('open-meteo-forecast', 'forecast');

    expect(service.remaining('minute')).toBe(599);
    expect(service.remaining('hour')).toBe(4_999);
    expect(service.remaining('day')).toBe(9_999);
  });

  it('spends three units when a call is retried twice', () => {
    const { service } = budget();

    // What the wrapper does: the limiter sits inside the retry, so every
    // attempt pays. Outside it, one token would have covered all three.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      service.tryConsume('open-meteo-forecast', 'forecast');
    }

    expect(service.remaining('day')).toBe(9_997);
  });

  it('refuses when any single window is exhausted', () => {
    const { service } = budget({ minute: 2, hour: 5_000, day: 10_000 });

    expect(service.tryConsume('s', 'forecast')).toBe(true);
    expect(service.tryConsume('s', 'forecast')).toBe(true);
    expect(service.tryConsume('s', 'forecast')).toBe(false);
    // The exhausted window took nothing further, and neither did the others.
    expect(service.remaining('day')).toBe(9_998);
  });

  it('names the window that is binding', () => {
    const { service } = budget({ minute: 600, hour: 5_000, day: 10 });

    expect(service.bindingWindow()).toBe('day');
  });

  it('recovers as the window refills', () => {
    const { service, advance } = budget({ minute: 1, hour: 5_000, day: 10_000 });

    expect(service.tryConsume('s', 'forecast')).toBe(true);
    expect(service.tryConsume('s', 'forecast')).toBe(false);
    advance(60_000);
    expect(service.tryConsume('s', 'forecast')).toBe(true);
  });
});

describe('what the budget exposes', () => {
  it('reports what remains of each window', () => {
    const { service, metrics } = budget();

    service.tryConsume('s', 'forecast');

    expect(metrics.read(METRIC.budgetRemaining, { window: 'minute' })).toBe(599);
    expect(metrics.read(METRIC.budgetRemaining, { window: 'hour' })).toBe(4_999);
    expect(metrics.read(METRIC.budgetRemaining, { window: 'day' })).toBe(9_999);
  });

  it('moves the gauge as the budget is consumed', () => {
    const { service, metrics } = budget();
    const before = metrics.read(METRIC.budgetRemaining, { window: 'day' });

    service.tryConsume('s', 'forecast');
    service.tryConsume('s', 'forecast');

    expect(metrics.read(METRIC.budgetRemaining, { window: 'day' })).toBe(before - 2);
  });

  it('counts a refusal as its own outcome rather than as an attempt', () => {
    const { service, metrics } = budget({ minute: 1, hour: 5_000, day: 10_000 });

    service.tryConsume('s', 'forecast');
    service.tryConsume('s', 'forecast');

    expect(metrics.read(METRIC.outboundAttempts, { source: 's', capability: 'forecast' })).toBe(1);
    expect(metrics.read(METRIC.budgetShed, { source: 's', capability: 'forecast' })).toBe(1);
  });
});
