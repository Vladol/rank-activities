import type { FeatureId, Score01, Score100, Weight } from '../shared/branded';
import type { ReasonCode } from '../shared/reason-code';
import type { CanonicalUnit } from '../weather/units';
import type { RequirableMetric } from '../weather/derived/derived-metric.registry';
import type { FeatureRole } from '../activity/activity-definition';

/**
 * One activity's answer for one day (docs/development-flow/stage-five.md,
 * section 7.5). Three states, and no fourth: a zero is a score with a reason,
 * never a stand-in for a refusal, and a refusal is never a zero.
 */
export type ActivityOutcome =
  | {
      readonly kind: 'ranked';
      readonly score: Score100;
      /** Present exactly when the score is a constraint-driven zero. */
      readonly constraintViolated?: ReasonCode;
      readonly breakdown: readonly FeatureContribution[];
      readonly definitionVersion: number;
      readonly profileId: string;
      readonly profileVersion: number;
    }
  | { readonly kind: 'not_applicable'; readonly reason: ReasonCode }
  | {
      readonly kind: 'no_data';
      readonly reason: ReasonCode;
      readonly missingMetrics: readonly RequirableMetric[];
      readonly retryable: boolean;
    };

/**
 * The explanation is not a description of the calculation, it *is* the
 * calculation split into its terms — which is why an excluded feature stays in
 * the list with a null weight instead of disappearing, and why `raw: null`
 * beside `status: 'degraded'` is the only way to tell "this feature scored 0.5"
 * from "this feature scored 0.5 because there was nothing to score".
 */
export interface FeatureContribution {
  readonly featureId: FeatureId;
  readonly metric: RequirableMetric;
  readonly role: FeatureRole;
  readonly status: 'used' | 'degraded' | 'excluded';
  readonly raw: {
    readonly value: number;
    readonly unit: CanonicalUnit;
    readonly sampleCount: number;
    readonly missingCount: number;
  } | null;
  readonly normalized: Score01;
  /** Effective, after any redistribution; `null` for a limiting feature. */
  readonly weight: Weight | null;
  /** `weight * normalized`; `null` for a limiting feature. */
  readonly contribution: Score01 | null;
  /** Only a limiting feature has one. */
  readonly gateFactor: Score01 | null;
}
