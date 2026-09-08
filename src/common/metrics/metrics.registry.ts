/**
 * The counters and gauges this service keeps, and nothing more.
 *
 * Prometheus arrives with `service-observability` in stage 7; what cannot wait
 * for it is the *registry*, because ADR 0004 asks for the cache and budget
 * numbers to exist from the first module rather than to be retrofitted. An
 * exporter reads this snapshot later; the code that records is written once.
 */
export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricSample {
  readonly name: string;
  readonly labels: MetricLabels;
  readonly value: number;
}

export class MetricsRegistry {
  private readonly values = new Map<string, MetricSample>();

  /** Adds to a running total. A counter only ever goes up. */
  increment(name: string, labels: MetricLabels = {}, by = 1): void {
    const id = seriesId(name, labels);
    const current = this.values.get(id);

    this.values.set(id, { name, labels, value: (current?.value ?? 0) + by });
  }

  /** Records a level that can fall as well as rise: remaining budget, for one. */
  set(name: string, value: number, labels: MetricLabels = {}): void {
    this.values.set(seriesId(name, labels), { name, labels, value });
  }

  read(name: string, labels: MetricLabels = {}): number {
    return this.values.get(seriesId(name, labels))?.value ?? 0;
  }

  snapshot(): readonly MetricSample[] {
    return [...this.values.values()];
  }

  reset(): void {
    this.values.clear();
  }
}

export const METRICS: unique symbol = Symbol('MetricsRegistry');

/** The metric names this change introduces, declared once so a typo cannot split a series. */
export const METRIC = {
  cacheOperations: 'weather_cache_operations_total',
  cacheEntries: 'weather_cache_entries',
  cacheBytes: 'weather_cache_bytes',
  singleFlightJoins: 'weather_cache_single_flight_joins_total',
  breakerState: 'weather_source_breaker_state',
  budgetRemaining: 'weather_source_budget_remaining',
  budgetShed: 'weather_source_budget_shed_total',
  outboundAttempts: 'weather_source_attempts_total',
} as const;

/** `cache operations` is one series with an outcome label, not four counters. */
export const CACHE_OUTCOMES = ['hit', 'miss', 'stale', 'negative_hit', 'error'] as const;

export type CacheOutcome = (typeof CACHE_OUTCOMES)[number];

function seriesId(name: string, labels: MetricLabels): string {
  const pairs = Object.entries(labels)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');

  return `${name}{${pairs}}`;
}
