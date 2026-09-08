import { METRIC, type MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { TokenBucket } from './token-bucket';

/** The three windows Open-Meteo publishes (stage-three.md, section 7.4). */
export const BUDGET_WINDOWS = ['minute', 'hour', 'day'] as const;

export type BudgetWindow = (typeof BUDGET_WINDOWS)[number];

export type BudgetLimits = Readonly<Record<BudgetWindow, number>>;

const WINDOW_MS: Readonly<Record<BudgetWindow, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export interface OutboundBudgetOptions {
  readonly limits: BudgetLimits;
  readonly now?: () => number;
  readonly metrics?: MetricsRegistry;
}

/**
 * What the service is still allowed to send.
 *
 * The unit is an **attempt**, not a user request and not a logical call. A
 * retry spends quota exactly like a first attempt, and retries multiply
 * precisely when the source degrades, so counting anything else understates
 * consumption by up to three times at the worst possible moment
 * (ADR 0006, and design.md Decision 7).
 *
 * The daily window is the one that binds: ten thousand a day is about seven a
 * minute sustained, while the hourly limit would permit burning half a day's
 * budget in an hour — which a traffic spike does by itself.
 */
export class OutboundBudgetService {
  private readonly buckets: ReadonlyMap<BudgetWindow, TokenBucket>;
  private readonly metrics?: MetricsRegistry;

  constructor(options: OutboundBudgetOptions) {
    const now = options.now ?? ((): number => Date.now());

    this.buckets = new Map(
      BUDGET_WINDOWS.map((window) => [
        window,
        new TokenBucket(options.limits[window], WINDOW_MS[window], now),
      ]),
    );
    this.metrics = options.metrics;
    this.publish();
  }

  /**
   * One attempt's worth of budget, from every window at once or from none.
   *
   * There is no waiting variant on purpose: a request that finds no budget is
   * answered, not queued. A queue converts an exhausted quota into a rising
   * p95 — an outage disguised as slowness, arriving without a single error to
   * point at (design.md, Decision 6).
   */
  tryConsume(source: string, capability: string): boolean {
    const exhausted = [...this.buckets.values()].some((bucket) => bucket.remaining < 1);

    if (exhausted) {
      this.metrics?.increment(METRIC.budgetShed, { source, capability });
      this.publish();

      return false;
    }

    for (const bucket of this.buckets.values()) {
      bucket.tryConsume();
    }

    this.metrics?.increment(METRIC.outboundAttempts, { source, capability });
    this.publish();

    return true;
  }

  remaining(window: BudgetWindow): number {
    return this.buckets.get(window)?.remaining ?? 0;
  }

  /** The window that is binding right now, for the log line on a shed request. */
  bindingWindow(): BudgetWindow {
    return BUDGET_WINDOWS.reduce((tightest, window) =>
      this.remaining(window) < this.remaining(tightest) ? window : tightest,
    );
  }

  private publish(): void {
    for (const window of BUDGET_WINDOWS) {
      this.metrics?.set(METRIC.budgetRemaining, this.remaining(window), { window });
    }
  }
}
