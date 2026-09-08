import type { MetricsRegistry } from '../../../common/metrics/metrics.registry';
import type { Capability } from '../../../domain/weather/metric';
import type { SeriesPort } from '../ports/series.port';

/**
 * The metric names this wrapper keeps. Latency arrives as a sum and a count
 * rather than as a histogram: the exporter is stage 7's, and an average that
 * exists now is worth more than a histogram that does not (ADR 0004).
 */
export const OBSERVED = {
  outcomes: 'weather_source_outcomes_total',
  durationSum: 'weather_source_duration_ms_sum',
  durationCount: 'weather_source_duration_ms_count',
} as const;

export interface ObservedOptions {
  readonly metrics: MetricsRegistry;
  readonly now?: () => number;
}

/**
 * The outermost wrapper, and deliberately so: it measures what the caller
 * experiences, cache hits included. Latency "net of the cache" is a number
 * about the code rather than about the service (stage-four.md, section 5.4).
 */
export function observeSeriesPort<Served extends Capability>(
  port: SeriesPort<Served>,
  options: ObservedOptions,
): SeriesPort<Served> {
  const now = options.now ?? ((): number => Date.now());
  const label = { source: port.sourceId, capability: port.capability };

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
    fetch: async (request) => {
      const started = now();
      const answered = await port.fetch(request);
      const outcome = answered.ok
        ? answered.value.provenance.some((entry) => entry.stale)
          ? 'stale'
          : 'ok'
        : answered.error.code;

      options.metrics.increment(OBSERVED.outcomes, { ...label, outcome });
      options.metrics.increment(OBSERVED.durationSum, label, now() - started);
      options.metrics.increment(OBSERVED.durationCount, label);

      return answered;
    },
  };
}
