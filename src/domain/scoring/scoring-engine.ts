import type {
  AggregationSpec,
  ConstraintExpr,
  ResolvedDefinition,
  ResolvedFeature,
} from '../activity/activity-definition';
import type { ActivityOutcome, FeatureContribution } from '../ranking/activity-outcome';
import { type Score01, type Score100, clamp01, toScore100, weight } from '../shared/branded';
import type { ReasonCode } from '../shared/reason-code';
import {
  type AggregatedValue,
  type MetricChannel,
  aggregatorEntry,
} from '../weather/aggregation/aggregator.registry';
import { evaluatePredicate } from '../weather/aggregation/predicate';
import type { DayWindow } from '../weather/day-window';
import {
  type RequirableMetric,
  computeDerived,
  derivedMetric,
  isDerivedMetric,
} from '../weather/derived/derived-metric.registry';
import { type MetricCode, metric } from '../weather/metric';
import type { WeatherSeries } from '../weather/weather-series';
import { normalizerEntry } from './normalizer.registry';
import type { ScoringProfile } from './scoring-profile';

/**
 * The pipeline of docs/development-flow/stage-five.md, section 9: six stages,
 * each with its own type on the way in and out. Nothing here knows the name of
 * an activity; everything it does, it does because a declaration said so.
 *
 * The order of stages 2 to 4 is the substance, not the sequence of calls:
 *
 * - coverage before constraints, because a day that is 80 per cent empty
 *   entitles us to no statement at all, "there is no snow here" included;
 * - constraints before the null policy, because a fired constraint is
 *   knowledge and an absent metric is the lack of it, and knowledge decides
 *   first — the opposite order answers NoData where the answer is obvious;
 * - a constraint over an absent value does not fire: `max(snow_depth)` with no
 *   data does not mean there is no snow.
 */
export function scoreActivity(
  definition: ResolvedDefinition,
  series: WeatherSeries,
  window: DayWindow,
  profile: ScoringProfile,
): ActivityOutcome {
  const values = extractValues(definition, series, window);

  const gaps = checkCoverage(definition, values, profile);

  if (gaps !== undefined) {
    return gaps;
  }

  const fired = evaluateConstraints(definition, values);

  if (fired !== undefined) {
    return ranked(definition, profile, clamp01(0), [], fired);
  }

  const applied = applyNullPolicy(definition, values);

  if ('missing' in applied) {
    return {
      kind: 'no_data',
      reason: 'MISSING_REQUIRED_METRIC',
      missingMetrics: applied.missing,
      retryable: false,
    };
  }

  const combined = normalizeAndCombine(applied.features, profile);

  return ranked(definition, profile, combined.score, combined.breakdown);
}

/* ---------------------------------------------------------------- stage 1 */

/** A key that identifies one aggregated quantity: a metric read one way. */
function valueKey(code: RequirableMetric, aggregation: AggregationSpec): string {
  return `${code}|${aggregation.type}|${JSON.stringify(aggregation.params ?? null)}`;
}

export interface ExtractedValues {
  of(code: RequirableMetric, aggregation: AggregationSpec): AggregatedValue | null;
}

/**
 * Aggregates everything the declaration refers to — features *and*
 * constraints. `weather_code` is nobody's feature, and without it the shared
 * severe-weather rule cannot be decided.
 */
export function extractValues(
  definition: ResolvedDefinition,
  series: WeatherSeries,
  window: DayWindow,
): ExtractedValues {
  const values = new Map<string, AggregatedValue | null>();

  const put = (code: RequirableMetric, aggregation: AggregationSpec): void => {
    const key = valueKey(code, aggregation);

    if (!values.has(key)) {
      values.set(key, aggregate(code, aggregation, series, window));
    }
  };

  for (const feature of definition.features) {
    put(feature.metric, feature.aggregation);
  }

  for (const constraint of definition.constraints) {
    walkExpr(constraint.when, (leaf) => put(leaf.metric, leaf.aggregation));
  }

  return {
    of: (code, aggregation) => values.get(valueKey(code, aggregation)) ?? null,
  };
}

function aggregate(
  code: RequirableMetric,
  aggregation: AggregationSpec,
  series: WeatherSeries,
  window: DayWindow,
): AggregatedValue | null {
  const entry = aggregatorEntry(aggregation.type);
  const channel = channelFor(code, entry.granularity, series);

  if (channel === undefined) {
    return null;
  }

  const params = entry.params.safeParse(aggregation.params ?? {});

  // The declaration was validated on load; an unparsable spec here would be
  // our own bug, and answering "no value" would hide it.
  return entry.fn(channel, window, params.success ? params.data : aggregation.params);
}

function channelFor(
  code: RequirableMetric,
  granularity: 'hourly' | 'daily',
  series: WeatherSeries,
): MetricChannel | undefined {
  if (isDerivedMetric(code)) {
    const values = computeDerived(code, series);

    return values === undefined ? undefined : { values, unit: derivedMetric(code).unit };
  }

  const source = granularity === 'daily' ? series.daily : series.hourly;
  const values = source.values[code as MetricCode];

  return values === undefined
    ? undefined
    : { values, unit: metric(code as MetricCode).canonicalUnit };
}

/* ---------------------------------------------------------------- stage 2 */

/**
 * A day is too incomplete to judge when a metric the activity cannot do
 * without holds *some* values and too few of them. A metric with no value at
 * all is not a gap — it is an absent metric, and stage 4 decides it. Without
 * that distinction the ERA5 archive, whose visibility is null in all 168
 * slots, would never be scored.
 */
export function checkCoverage(
  definition: ResolvedDefinition,
  values: ExtractedValues,
  profile: ScoringProfile,
): ActivityOutcome | undefined {
  for (const feature of definition.features) {
    if (feature.nullPolicy !== 'fail') {
      continue;
    }

    const value = values.of(feature.metric, feature.aggregation);

    if (value === null || value.sampleCount === 0) {
      continue;
    }

    const slots = value.sampleCount + value.missingCount;

    if (slots > 0 && value.missingCount / slots > profile.gapThreshold) {
      return {
        kind: 'no_data',
        reason: 'TOO_MANY_GAPS',
        missingMetrics: [feature.metric],
        retryable: false,
      };
    }
  }

  return undefined;
}

/* ---------------------------------------------------------------- stage 3 */

export function evaluateConstraints(
  definition: ResolvedDefinition,
  values: ExtractedValues,
): ReasonCode | undefined {
  for (const constraint of definition.constraints) {
    if (holds(constraint.when, values) === true) {
      return constraint.reason;
    }
  }

  return undefined;
}

/**
 * `undefined` is "cannot be decided", and it is not `false`: negating an
 * unknown must not produce a refusal, and a disjunction one of whose branches
 * has no data is only true if another branch actually fired.
 */
function holds(expr: ConstraintExpr, values: ExtractedValues): boolean | undefined {
  if ('anyOf' in expr) {
    const branches = expr.anyOf.map((branch) => holds(branch, values));

    return branches.includes(true) ? true : branches.includes(undefined) ? undefined : false;
  }

  if ('allOf' in expr) {
    const branches = expr.allOf.map((branch) => holds(branch, values));

    return branches.includes(false) ? false : branches.includes(undefined) ? undefined : true;
  }

  if ('not' in expr) {
    const inner = holds(expr.not, values);

    return inner === undefined ? undefined : !inner;
  }

  const value = values.of(expr.metric, expr.aggregation);

  return value === null ? undefined : evaluatePredicate({ op: expr.op, value: expr.value }, value.value);
}

function walkExpr(
  expr: ConstraintExpr,
  visit: (leaf: Extract<ConstraintExpr, { metric: RequirableMetric }>) => void,
): void {
  if ('anyOf' in expr) {
    expr.anyOf.forEach((branch) => walkExpr(branch, visit));
  } else if ('allOf' in expr) {
    expr.allOf.forEach((branch) => walkExpr(branch, visit));
  } else if ('not' in expr) {
    walkExpr(expr.not, visit);
  } else {
    visit(expr);
  }
}

/* ---------------------------------------------------------------- stage 4 */

interface AppliedFeature {
  readonly feature: ResolvedFeature;
  readonly value: AggregatedValue | null;
  readonly status: 'used' | 'degraded' | 'excluded';
  /** Effective weight after redistribution; `null` unless contributing. */
  readonly weight: number | null;
}

/**
 * Assigns each feature a status and an effective weight. Turning a status into
 * a number is stage 5's job: `degrade` means "score the profile's neutral
 * value", and that value is a normalised one, so it belongs where normalisation
 * happens rather than here.
 */
export function applyNullPolicy(
  definition: ResolvedDefinition,
  values: ExtractedValues,
): { features: readonly AppliedFeature[] } | { missing: readonly RequirableMetric[] } {
  const missing: RequirableMetric[] = [];
  const read = definition.features.map((feature) => {
    const value = values.of(feature.metric, feature.aggregation);

    if (value !== null) {
      return { feature, value, status: 'used' as const };
    }

    if (feature.nullPolicy === 'fail') {
      missing.push(feature.metric);

      return { feature, value: null, status: 'used' as const };
    }

    return {
      feature,
      value: null,
      status: feature.nullPolicy === 'degrade' ? ('degraded' as const) : ('excluded' as const),
    };
  });

  if (missing.length > 0) {
    return { missing };
  }

  const kept = read.filter(
    (entry) => entry.feature.role === 'additive' && entry.status !== 'excluded',
  );
  const total = kept.reduce((sum, entry) => sum + (entry.feature.weight ?? 0), 0);

  if (total <= 0) {
    // Nothing contributing survived; there is no honest number to give.
    return { missing: read.filter((entry) => entry.status === 'excluded').map((entry) => entry.feature.metric) };
  }

  return {
    features: read.map((entry) => ({
      ...entry,
      // Redistributed proportionally, so an excluded feature leaves the score
      // on the same scale as a fully supplied day.
      weight:
        entry.feature.role === 'additive' && entry.status !== 'excluded'
          ? (entry.feature.weight ?? 0) / total
          : null,
    })),
  };
}

/* ---------------------------------------------------------------- stage 5 */

/**
 * The weighted sum of the contributing features, then each limiting feature as
 * a factor on it, floored at the limit that feature declares
 * (stage-five.md, section 5.5). The breakdown falls out of the same pass: an
 * explanation produced by a second pass is an explanation that can disagree
 * with the number, and it is the explanation that gets shown.
 */
export function normalizeAndCombine(
  features: readonly AppliedFeature[],
  profile: ScoringProfile,
): { score: Score01; breakdown: readonly FeatureContribution[] } {
  let sum = 0;
  let gates = 1;
  const breakdown: FeatureContribution[] = [];

  for (const entry of features) {
    const { feature } = entry;
    const normalized =
      entry.value === null
        ? profile.neutralScore
        : normalizerEntry(feature.normalizer.type).fn(entry.value.value, feature.normalizer.params);

    const raw =
      entry.value === null
        ? null
        : {
            value: entry.value.value,
            unit: entry.value.unit,
            sampleCount: entry.value.sampleCount,
            missingCount: entry.value.missingCount,
          };

    if (feature.role === 'gate') {
      // No data is no punishment: a degraded gate is a factor of 1.
      const factor =
        entry.status === 'degraded'
          ? clamp01(1)
          : clamp01((feature.gateFloor ?? 0) + (1 - (feature.gateFloor ?? 0)) * normalized);

      gates *= factor;
      breakdown.push({
        featureId: feature.id,
        metric: feature.metric,
        role: 'gate',
        status: entry.status,
        raw,
        normalized: entry.status === 'excluded' ? clamp01(0) : normalized,
        weight: null,
        contribution: null,
        gateFactor: factor,
      });
      continue;
    }

    if (entry.status === 'excluded') {
      breakdown.push({
        featureId: feature.id,
        metric: feature.metric,
        role: 'additive',
        status: 'excluded',
        raw: null,
        normalized: clamp01(0),
        weight: null,
        contribution: null,
        gateFactor: null,
      });
      continue;
    }

    const effective = entry.weight ?? 0;
    const contribution = effective * normalized;

    sum += contribution;
    breakdown.push({
      featureId: feature.id,
      metric: feature.metric,
      role: 'additive',
      status: entry.status,
      raw,
      normalized,
      weight: weight(effective),
      contribution: clamp01(contribution),
      gateFactor: null,
    });
  }

  return { score: clamp01(sum * gates), breakdown };
}

/* ---------------------------------------------------------------- stage 6 */

function ranked(
  definition: ResolvedDefinition,
  profile: ScoringProfile,
  score: Score01,
  breakdown: readonly FeatureContribution[],
  constraintViolated?: ReasonCode,
): ActivityOutcome {
  return {
    kind: 'ranked',
    score: postprocess(score, definition, constraintViolated !== undefined),
    ...(constraintViolated === undefined ? {} : { constraintViolated }),
    breakdown,
    definitionVersion: definition.version,
    profileId: profile.id,
    profileVersion: profile.version,
  };
}

/**
 * Bounds apply to the combined score, never to a feature's contribution: a
 * floor that depended on how many features happened to contribute would make
 * "indoor never drops below 40" unverifiable. A constraint outranks the floor —
 * Ranked(0, ...) is not lifted to 40.
 */
export function postprocess(
  score: Score01,
  definition: ResolvedDefinition,
  constraintFired: boolean,
): Score100 {
  const raw = toScore100(score);

  if (constraintFired) {
    return Math.round(raw) as Score100;
  }

  const floor = definition.postprocess?.floor ?? 0;
  const ceiling = definition.postprocess?.ceiling ?? 100;

  return Math.round(Math.min(Math.max(raw, floor), ceiling)) as Score100;
}
