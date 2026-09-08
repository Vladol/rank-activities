import {
  BulkheadPolicy,
  CircuitState,
  ConsecutiveBreaker,
  DelegateBackoff,
  type IRetryBackoffContext,
  TimeoutStrategy,
  bulkhead,
  circuitBreaker,
  handleWhenResult,
  isBrokenCircuitError,
  isBulkheadRejectedError,
  isTaskCancelledError,
  retry,
  timeout,
} from 'cockatiel';

import { METRIC, type MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { domainError } from '../../../domain/shared/domain-error';
import { type Result, err } from '../../../domain/shared/result';
import type { Capability } from '../../../domain/weather/metric';
import type { WeatherSeries } from '../../../domain/weather/weather-series';
import type { OutboundBudgetService } from '../outbound-budget/outbound-budget.service';
import type { SeriesRequest, WeatherError } from '../ports/contracts';
import type { SeriesPort } from '../ports/series.port';
import {
  type BackoffOptions,
  isRetryableFailure,
  isSourceFault,
  retryDelayMs,
} from './failure-classification';

export interface ResilienceOptions {
  readonly budget: OutboundBudgetService;
  /** Including the first: 3 means one call and two retries. */
  readonly maxAttempts: number;
  readonly backoff: BackoffOptions;
  /** Per attempt, never per chain: a chain of three may honestly take three times as long. */
  readonly timeoutMs: number;
  readonly breaker: {
    readonly consecutiveFailures: number;
    readonly halfOpenAfterMs: number;
  };
  /**
   * How many calls may be in flight at once, and how many may wait for a slot.
   * The queue is short by design: waiting is the failure mode this whole layer
   * refuses (design.md, Decision 6).
   */
  readonly concurrency: { readonly limit: number; readonly queue: number };
  readonly metrics?: MetricsRegistry;
}

type SeriesResult = Result<WeatherSeries, WeatherError>;

/**
 * Everything that stands between a decision to call and the call itself.
 *
 * The order is the whole design (stage-four.md, section 5.4):
 *
 * ```
 * circuit breaker → retry → budget + bulkhead → timeout → the source
 * ```
 *
 * The breaker is **outside** the retry, so one logical call is one event for
 * it and three retries do not open it three times faster than intended. The
 * budget is **inside**, so every attempt pays for itself — outside it, one
 * token would cover three real calls and the counter would understate
 * consumption by exactly the factor that matters (design.md, Decision 7).
 *
 * One instance of this wrapper is one source-and-capability pair, which is
 * what makes the breaker per pair: a failing wave model costs surfing, not the
 * forecast served by the same vendor (design.md, Decision 8).
 */
export function resilientSeriesPort<Served extends Capability>(
  port: SeriesPort<Served>,
  options: ResilienceOptions,
): SeriesPort<Served> {
  const label = { source: port.sourceId, capability: port.capability };

  const breaker = circuitBreaker(
    handleWhenResult((result) => isFailure(result) && isSourceFault(result.error)),
    {
      halfOpenAfter: options.breaker.halfOpenAfterMs,
      breaker: new ConsecutiveBreaker(options.breaker.consecutiveFailures),
    },
  );

  options.metrics?.set(METRIC.breakerState, CircuitState.Closed, label);
  breaker.onStateChange((state) => options.metrics?.set(METRIC.breakerState, state, label));

  const retrying = retry(
    handleWhenResult((result) => isFailure(result) && isRetryableFailure(result.error)),
    {
      // Cockatiel counts *retries*; ours counts attempts, first one included,
      // because that is what the budget spends and what `.env.example`
      // documents. Three attempts is two retries.
      maxAttempts: Math.max(0, options.maxAttempts - 1),
      backoff: new DelegateBackoff<IRetryBackoffContext<unknown>>((context) =>
        retryDelayMs(context.attempt, failureIn(context.result), options.backoff),
      ),
    },
  );

  const limiter: BulkheadPolicy = bulkhead(options.concurrency.limit, options.concurrency.queue);
  const bounded = timeout(options.timeoutMs, TimeoutStrategy.Aggressive);

  /**
   * One attempt: a slot, a unit of budget, a bounded call. The budget is taken
   * after the slot, so a call the bulkhead never let out costs nothing.
   */
  const attempt = async (request: SeriesRequest): Promise<SeriesResult> => {
    try {
      return await limiter.execute(async () => {
        if (!options.budget.tryConsume(port.sourceId, port.capability)) {
          return err(
            domainError('PROVIDER_BUSY', 'the outbound budget for this window is spent', {
              ...label,
              window: options.budget.bindingWindow(),
            }),
          );
        }

        return await bounded.execute(() => port.fetch(request));
      });
    } catch (thrown) {
      return err(translate(thrown, label));
    }
  };

  return {
    get sourceId(): string {
      return port.sourceId;
    },
    get capability(): Served {
      return port.capability;
    },
    get limits() {
      return port.limits;
    },
    supports: (metric) => port.supports(metric),
    fetch: async (request: SeriesRequest): Promise<SeriesResult> => {
      try {
        return await breaker.execute(() => retrying.execute(() => attempt(request)));
      } catch (thrown) {
        return err(translate(thrown, label));
      }
    },
  };
}

/**
 * What a policy threw, as one of our own codes. Nothing leaves this layer as
 * an exception: the port contract is a typed result, and a policy rejecting is
 * still a failure that originated outside our request.
 */
function translate(thrown: unknown, label: Readonly<Record<string, string>>): WeatherError {
  if (isBrokenCircuitError(thrown)) {
    return domainError(
      'CIRCUIT_OPEN',
      'repeated failures have cut this capability off for now',
      label,
    );
  }

  if (isBulkheadRejectedError(thrown)) {
    return domainError('PROVIDER_BUSY', 'too many calls to this source are already in flight', label);
  }

  if (isTaskCancelledError(thrown)) {
    return domainError('TIMEOUT', 'the source did not answer within the attempt budget', label);
  }

  // An adapter that threw where the contract says it must not. It is contained
  // here rather than allowed to cancel the whole ranking.
  return domainError('TRANSPORT_FAILURE', 'the source threw instead of answering', {
    ...label,
    cause: thrown instanceof Error ? thrown.message : String(thrown),
  });
}

function isFailure(result: unknown): result is { ok: false; error: WeatherError } {
  return typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === false;
}

function failureIn(reason: { error: unknown } | { value: unknown }): WeatherError | undefined {
  const value = 'value' in reason ? reason.value : undefined;

  return isFailure(value) ? value.error : undefined;
}
