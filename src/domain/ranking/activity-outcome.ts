import type { FeatureId, Score01, Score100, Weight } from '../shared/branded';
import type { ReasonCode } from '../shared/reason-code';
import type { CanonicalUnit } from '../weather/units';
import type { RequirableMetric } from '../weather/derived/derived-metric.registry';
import type { FeatureRole } from '../activity/activity-definition';

/**
 * A score, its explanation, and the pair of versions the computation was made
 * under. `constraintViolated` is present exactly when a hard constraint drove
 * the score to zero.
 */
export interface Ranked {
  readonly kind: 'ranked';
  readonly score: Score100;
  /** Present exactly when the score is a constraint-driven zero. */
  readonly constraintViolated?: ReasonCode;
  readonly breakdown: readonly FeatureContribution[];
  readonly definitionVersion: number;
  readonly profileId: string;
  readonly profileVersion: number;
}

/**
 * The activity is impossible at this place. It carries a code and no score of
 * any value: a client that could read a number here would read it, and "there
 * is no sea here" is not a low one.
 */
export interface Inapplicable {
  readonly kind: 'not_applicable';
  readonly reason: ReasonCode;
}

/** We cannot answer honestly: what is missing, and whether asking again may help. */
export interface MissingData {
  readonly kind: 'no_data';
  readonly reason: ReasonCode;
  readonly missingMetrics: readonly RequirableMetric[];
  readonly retryable: boolean;
}

/**
 * One activity's answer for one day (docs/development-flow/stage-five.md,
 * section 7.5). Three states, and no fourth: a zero is a score with a reason,
 * never a stand-in for a refusal, and a refusal is never a zero.
 */
export type ActivityOutcome = Ranked | Inapplicable | MissingData;

/**
 * The score, or `null` where there is none. The only reader of `.score` on the
 * union, so that no other caller has to choose a fallback — and the obvious
 * fallback, zero, is precisely the confusion the union exists to prevent.
 */
export function scoreOf(outcome: ActivityOutcome): Score100 | null {
  return outcome.kind === 'ranked' ? outcome.score : null;
}

/**
 * Whatever reason the outcome carries, from the one registry: the violated
 * constraint of a ranked zero, or the reason of a refusal. A ranked result
 * that no constraint touched has none, and says so.
 */
export function reasonOf(outcome: ActivityOutcome): ReasonCode | undefined {
  return outcome.kind === 'ranked' ? outcome.constraintViolated : outcome.reason;
}

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
