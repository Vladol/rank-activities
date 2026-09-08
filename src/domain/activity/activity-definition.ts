import type { FeatureId, Score01, Weight } from '../shared/branded';
import type { ReasonCode } from '../shared/reason-code';
import type { AggregationCode } from '../weather/aggregation/aggregator.registry';
import type { CompareOp } from '../weather/aggregation/predicate';
import type { RequirableMetric } from '../weather/derived/derived-metric.registry';
import type { CanonicalUnit } from '../weather/units';
import type { NormalizerCode } from '../scoring/normalizer.registry';

/**
 * The declaration contract of docs/development-flow/stage-five.md, section 7.1.
 *
 * `params` is `unknown` on purpose: their shape is known to the registry entry,
 * not to this file, and is checked on load against that entry's own schema.
 * That is what keeps a new curve from having to be declared twice
 * (design.md, Decision 1).
 *
 * The word the specs use for `role: 'gate'` is **limiting feature**. The JSON
 * keeps `gate` because that is what stage five wrote and the seeds are data;
 * one vocabulary, one place to look.
 */
export type NullPolicy = 'degrade' | 'exclude' | 'fail';

export type FeatureRole = 'additive' | 'gate';

export interface AggregationSpec {
  readonly type: AggregationCode;
  readonly params?: unknown;
}

export interface NormalizerSpec {
  readonly type: NormalizerCode;
  readonly params: unknown;
}

export interface ApplicabilityRuleRef {
  readonly rule: string;
  readonly params?: unknown;
}

/** A leaf compares one aggregated metric; the branches compose leaves. */
export type ConstraintExpr =
  | {
      readonly metric: RequirableMetric;
      readonly unit: CanonicalUnit;
      readonly aggregation: AggregationSpec;
      readonly op: CompareOp;
      readonly value: number | readonly number[];
    }
  | { readonly anyOf: readonly ConstraintExpr[] }
  | { readonly allOf: readonly ConstraintExpr[] }
  | { readonly not: ConstraintExpr };

export interface HardConstraint {
  /** From the registry, never a free string: the result carries this code. */
  readonly reason: ReasonCode;
  readonly when: ConstraintExpr;
}

export interface ScoreBounds {
  readonly floor?: number;
  readonly ceiling?: number;
}

/**
 * A feature after the load: the weights of the contributing features have been
 * normalised to sum to one, and a limiting feature carries no weight at all.
 */
export interface ResolvedFeature {
  readonly id: FeatureId;
  readonly metric: RequirableMetric;
  readonly unit: CanonicalUnit;
  readonly aggregation: AggregationSpec;
  readonly normalizer: NormalizerSpec;
  readonly nullPolicy: NullPolicy;
  readonly role: FeatureRole;
  /** Effective share of the score; `null` for a limiting feature. */
  readonly weight: Weight | null;
  /** How far the feature may pull the score down; `null` unless limiting. */
  readonly gateFloor: Score01 | null;
}

/**
 * A declaration with its includes expanded and its weights normalised — what
 * the engine is handed, and the only shape it can be handed.
 */
export interface ResolvedDefinition {
  readonly code: string;
  readonly version: number;
  readonly titleKey: string;
  readonly applicability: readonly ApplicabilityRuleRef[];
  /** Included rules first, then the activity's own, in declared order. */
  readonly constraints: readonly HardConstraint[];
  readonly features: readonly ResolvedFeature[];
  readonly postprocess?: ScoreBounds;
  /**
   * A stable digest of the declaration's content, so republishing a version
   * with different content can be refused without keeping the text around.
   */
  readonly fingerprint: string;
}

export function contributingFeatures(
  definition: ResolvedDefinition,
): readonly ResolvedFeature[] {
  return definition.features.filter((feature) => feature.role === 'additive');
}

export function limitingFeatures(definition: ResolvedDefinition): readonly ResolvedFeature[] {
  return definition.features.filter((feature) => feature.role === 'gate');
}
