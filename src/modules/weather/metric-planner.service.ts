import { Injectable } from '@nestjs/common';

import { domainError } from '../../domain/shared/domain-error';
import { type Result, err, ok } from '../../domain/shared/result';
import {
  type DerivedMetricCode,
  type RequirableMetric,
  derivedMetric,
  isDerivedMetric,
} from '../../domain/weather/derived/derived-metric.registry';
import {
  CAPABILITIES,
  type Capability,
  METRICS,
  type MetricCode,
  isMetricCode,
  metric,
} from '../../domain/weather/metric';
import type { Coordinates, Horizon, SeriesRequest, WeatherError } from './ports/contracts';

export interface PlanInput {
  /** The union of what the applicable activities declare, duplicates and all. */
  readonly requirements: readonly RequirableMetric[];
  readonly location: Coordinates;
  readonly horizon: Horizon;
  readonly timezone: 'auto' | string;
}

export interface MetricPlan {
  /** One request per capability that is actually needed, and none for the rest. */
  readonly requests: readonly SeriesRequest[];
  /** Computed after the series arrive, never asked of a source. */
  readonly derived: readonly DerivedMetricCode[];
}

const DICTIONARY_ORDER = Object.keys(METRICS) as MetricCode[];

/**
 * Turns what the applicable activities need into the smallest set of calls
 * that covers it. An inland location makes no marine call because nothing
 * applicable there declares a wave metric — not because anything in the code
 * knows what a coastline is.
 */
@Injectable()
export class MetricPlannerService {
  plan(input: PlanInput): Result<MetricPlan, WeatherError> {
    const source = new Set<MetricCode>();
    const derived = new Set<DerivedMetricCode>();

    for (const requirement of input.requirements) {
      if (isDerivedMetric(requirement)) {
        derived.add(requirement);

        for (const dependency of derivedMetric(requirement).requires) {
          source.add(dependency);
        }

        continue;
      }

      if (!isMetricCode(requirement)) {
        return err(
          domainError('UNSUPPORTED_METRIC', `no source serves the metric "${requirement}"`, {
            metric: requirement,
          }),
        );
      }

      source.add(requirement);
    }

    return ok({
      requests: CAPABILITIES.flatMap((capability) =>
        this.requestFor(capability, source, input),
      ),
      derived: [...derived],
    });
  }

  private requestFor(
    capability: Capability,
    wanted: ReadonlySet<MetricCode>,
    input: PlanInput,
  ): SeriesRequest[] {
    // Dictionary order, so the same plan is always the same bytes — which is
    // what makes a cache key out of it later.
    const metrics = DICTIONARY_ORDER.filter(
      (code) => wanted.has(code) && metric(code).capability === capability,
    );

    return metrics.length === 0
      ? []
      : [
          {
            capability,
            location: input.location,
            metrics,
            horizon: input.horizon,
            timezone: input.timezone,
          },
        ];
  }
}
