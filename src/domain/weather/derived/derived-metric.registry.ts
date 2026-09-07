import type { CanonicalUnit } from '../units';
import type { MetricCode } from '../metric';

/**
 * The three features no source variable expresses
 * (docs/development-flow/stage-five.md, section 4). They are declared here so
 * that the planner can expand them into the metrics it must actually fetch;
 * none of them knows the name of an activity.
 *
 * Only the dependency and the unit belong to this change. The formulas arrive
 * with the scoring, together with the fixtures that pin the direction
 * convention down — offshore is a difference of about 180 degrees, and no
 * amount of reasoning settles that sign.
 */
export interface DerivedMetricDefinition {
  readonly code: DerivedMetricCode;
  /** Source metrics the planner puts into the outgoing request instead. */
  readonly requires: readonly MetricCode[];
  readonly unit: CanonicalUnit;
}

export const DERIVED_METRICS = {
  /** Angle between wind and wave: 180 degrees is offshore, 0 is onshore. */
  WIND_WAVE_ALIGNMENT: {
    code: 'WIND_WAVE_ALIGNMENT',
    requires: ['wind_direction_10m', 'wave_direction'],
    unit: 'degree',
  },
  /** Snow that fell below freezing. Snowfall at +8 degrees is puddles. */
  FRESH_COLD_SNOWFALL: {
    code: 'FRESH_COLD_SNOWFALL',
    requires: ['snowfall', 'temperature_2m'],
    unit: 'cm',
  },
  /** Freezing level against the elevation of the answered grid node. */
  FREEZING_LEVEL_MARGIN: {
    code: 'FREEZING_LEVEL_MARGIN',
    requires: ['freezing_level_height'],
    unit: 'm',
  },
} as const satisfies Record<string, { code: string; requires: readonly MetricCode[]; unit: CanonicalUnit }>;

export type DerivedMetricCode = keyof typeof DERIVED_METRICS;

/**
 * What an activity may declare: a metric a source serves, or one we compute.
 * They are separate unions because a derived metric has no serving capability,
 * and the metric dictionary refuses an entry without one.
 */
export type RequirableMetric = MetricCode | DerivedMetricCode;

export function isDerivedMetric(value: string): value is DerivedMetricCode {
  return Object.hasOwn(DERIVED_METRICS, value);
}

export function derivedMetric(code: DerivedMetricCode): DerivedMetricDefinition {
  return DERIVED_METRICS[code];
}
