import { CircuitState } from 'cockatiel';
import { describe, expect, it } from 'vitest';

import { stubPort, stubSeries } from '../../../../test/support/stub-series-port';
import { METRIC, MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { domainError } from '../../../domain/shared/domain-error';
import { err, ok } from '../../../domain/shared/result';
import type { Capability } from '../../../domain/weather/metric';
import { OutboundBudgetService } from '../outbound-budget/outbound-budget.service';
import type { SeriesRequest } from '../ports/contracts';
import { type ResilienceOptions, resilientSeriesPort } from './resilient-series.port';

const REQUEST: SeriesRequest = {
  capability: 'forecast',
  location: { latitude: 38.72, longitude: -9.14 },
  metrics: ['temperature_2m'],
  horizon: { kind: 'forecast', forecastDays: 7 },
  timezone: 'Europe/Lisbon',
};

function marine(request: SeriesRequest): SeriesRequest {
  return { ...request, capability: 'marine', metrics: ['wave_height'] };
}

function options(overrides: Partial<ResilienceOptions> = {}): ResilienceOptions {
  return {
    budget: new OutboundBudgetService({ limits: { minute: 600, hour: 5_000, day: 10_000 } }),
    maxAttempts: 3,
    // Zero-length backoff: what is being asserted is how many attempts happen
    // and what they cost, not how long the process sleeps. The growth and the
    // jitter are a property of `retryDelayMs` and tested there.
    backoff: { initialDelayMs: 0, maxDelayMs: 0 },
    timeoutMs: 1_000,
    breaker: { consecutiveFailures: 3, halfOpenAfterMs: 60_000 },
    concurrency: { limit: 4, queue: 0 },
    ...overrides,
  };
}

function wrapped<Served extends Capability>(
  capability: Served,
  overrides: Partial<ResilienceOptions> = {},
  sourceId = 'open-meteo',
) {
  const inner = stubPort(capability, { sourceId });

  return { inner, port: resilientSeriesPort(inner, options(overrides)) };
}

describe('the budget counts what actually leaves', () => {
  it('spends one unit for an attempt that succeeds', async () => {
    const budget = new OutboundBudgetService({ limits: { minute: 600, hour: 5_000, day: 10_000 } });
    const { port } = wrapped('forecast', { budget });

    await port.fetch(REQUEST);

    expect(budget.remaining('day')).toBe(9_999);
  });

  it('spends three units for a call retried twice', async () => {
    const budget = new OutboundBudgetService({ limits: { minute: 600, hour: 5_000, day: 10_000 } });
    const { inner, port } = wrapped('forecast', { budget });
    let attempts = 0;

    inner.answer = (request) => {
      attempts += 1;

      return Promise.resolve(
        attempts < 3
          ? err(domainError('TRANSPORT_FAILURE', 'the call never completed'))
          : ok(stubSeries({ capability: 'forecast', request })),
      );
    };

    const answer = await port.fetch(REQUEST);

    // Asserted against the budget rather than by inspecting the wrapping: the
    // limiter being inside the retry is only meaningful as a number of tokens.
    expect(answer.ok).toBe(true);
    expect(inner.requests).toHaveLength(3);
    expect(budget.remaining('day')).toBe(9_997);
  });

  it('answers a spent budget without waiting for it to refill', async () => {
    const budget = new OutboundBudgetService({ limits: { minute: 1, hour: 5_000, day: 10_000 } });
    const { inner, port } = wrapped('forecast', { budget });

    await port.fetch(REQUEST);
    const started = Date.now();
    const shed = await port.fetch(REQUEST);

    expect(shed.ok).toBe(false);
    expect(!shed.ok && shed.error.code).toBe('PROVIDER_BUSY');
    expect(Date.now() - started).toBeLessThan(100);
    // Nothing left the process for the shed request.
    expect(inner.requests).toHaveLength(1);
  });

  it('does not retry its own exhausted budget', async () => {
    const budget = new OutboundBudgetService({ limits: { minute: 1, hour: 5_000, day: 10_000 } });
    const { port } = wrapped('forecast', { budget });

    await port.fetch(REQUEST);
    await port.fetch(REQUEST);

    // A second attempt would find the budget just as empty; only the metric
    // would move.
    expect(budget.remaining('day')).toBe(9_999);
  });
});

describe('the bulkhead bounds how many calls are out at once', () => {
  it('refuses beyond its limit and its queue rather than holding the request', async () => {
    const { inner, port } = wrapped('forecast', { concurrency: { limit: 2, queue: 1 } });
    let inFlight = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = (): void => resolve();
    });

    inner.answer = async (request) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate;
      inFlight -= 1;

      return ok(stubSeries({ capability: 'forecast', request }));
    };

    const calls = [
      port.fetch(REQUEST),
      port.fetch(REQUEST),
      port.fetch(REQUEST),
      port.fetch(REQUEST),
    ];

    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const answers = await Promise.all(calls);

    expect(peak).toBeLessThanOrEqual(2);
    // Two ran, one waited its turn in the queue, and the fourth was refused
    // rather than queued behind them.
    expect(answers.filter((answer) => !answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok && answer.error.code === 'PROVIDER_BUSY')).toHaveLength(1);
  });
});

describe('a failing capability does not stop another', () => {
  it('keeps the forecast callable while marine is cut off', async () => {
    const budget = new OutboundBudgetService({ limits: { minute: 600, hour: 5_000, day: 10_000 } });
    const forecast = wrapped('forecast', { budget }, 'open-meteo');
    const waves = wrapped('marine', { budget }, 'open-meteo');

    waves.inner.answer = () =>
      Promise.resolve(err(domainError('TRANSPORT_FAILURE', 'the wave host is down')));

    for (let call = 0; call < 4; call += 1) {
      await waves.port.fetch(marine(REQUEST));
    }

    const cutOff = await waves.port.fetch(marine(REQUEST));
    const stillWorking = await forecast.port.fetch(REQUEST);

    expect(!cutOff.ok && cutOff.error.code).toBe('CIRCUIT_OPEN');
    expect(stillWorking.ok).toBe(true);
  });

  it('stops calling a source it has cut off', async () => {
    const { inner, port } = wrapped('forecast', {
      breaker: { consecutiveFailures: 2, halfOpenAfterMs: 60_000 },
      maxAttempts: 1,
    });

    inner.answer = () => Promise.resolve(err(domainError('TIMEOUT', 'no answer')));

    await port.fetch(REQUEST);
    await port.fetch(REQUEST);
    const before = inner.requests.length;
    const open = await port.fetch(REQUEST);

    expect(!open.ok && open.error.code).toBe('CIRCUIT_OPEN');
    expect(inner.requests).toHaveLength(before);
  });

  it('does not cut a source off for a fault of our own making', async () => {
    const { inner, port } = wrapped('forecast', {
      breaker: { consecutiveFailures: 2, halfOpenAfterMs: 60_000 },
      maxAttempts: 1,
    });

    // A rejected horizon is our bug, not the source's: five of them in a row
    // must leave the source callable.
    inner.answer = () =>
      Promise.resolve(err(domainError('HORIZON_TOO_LARGE', 'a horizon of 30 days is too large')));

    for (let call = 0; call < 5; call += 1) {
      await port.fetch(REQUEST);
    }

    const last = await port.fetch(REQUEST);

    expect(!last.ok && last.error.code).toBe('HORIZON_TOO_LARGE');
  });

  it('reports the breaker state', async () => {
    const metrics = new MetricsRegistry();
    const inner = stubPort('marine', { sourceId: 'open-meteo' });
    const port = resilientSeriesPort(
      inner,
      options({ metrics, maxAttempts: 1, breaker: { consecutiveFailures: 2, halfOpenAfterMs: 60_000 } }),
    );
    const label = { source: 'open-meteo', capability: 'marine' };

    expect(metrics.read(METRIC.breakerState, label)).toBe(CircuitState.Closed);
    inner.answer = () => Promise.resolve(err(domainError('TIMEOUT', 'no answer')));

    await port.fetch(marine(REQUEST));
    await port.fetch(marine(REQUEST));

    expect(metrics.read(METRIC.breakerState, label)).toBe(CircuitState.Open);
  });
});

describe('every attempt is bounded in time', () => {
  it('gives up on an attempt that never answers', async () => {
    const { inner, port } = wrapped('forecast', { timeoutMs: 20, maxAttempts: 1 });

    inner.answer = () => new Promise(() => undefined);

    const answer = await port.fetch(REQUEST);

    expect(!answer.ok && answer.error.code).toBe('TIMEOUT');
  });

  it('bounds each attempt rather than the chain, so a retry gets its own budget', async () => {
    const { inner, port } = wrapped('forecast', { timeoutMs: 20, maxAttempts: 3 });
    let attempts = 0;

    inner.answer = (request) => {
      attempts += 1;

      return attempts < 3
        ? new Promise(() => undefined)
        : Promise.resolve(ok(stubSeries({ capability: 'forecast', request })));
    };

    expect((await port.fetch(REQUEST)).ok).toBe(true);
    expect(attempts).toBe(3);
  });
});

describe('an adapter that throws is contained', () => {
  it('turns a thrown error into a typed failure', async () => {
    const inner = stubPort('forecast');
    const port = resilientSeriesPort(inner, options({ maxAttempts: 1 }));

    inner.answer = () => {
      throw new Error('the adapter threw');
    };

    const answer = await port.fetch(REQUEST);

    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error.code).toBe('TRANSPORT_FAILURE');
  });
});
