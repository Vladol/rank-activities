import { type Score01, clamp01, featureId, weight } from '../shared/branded';
import { isReasonCode } from '../shared/reason-code';
import { type Result, err, ok } from '../shared/result';
import { normalizerRegistry } from '../scoring/normalizer.registry';
import {
  type AggregatorEntry,
  aggregatorRegistry,
} from '../weather/aggregation/aggregator.registry';
import { COMPARE_OPS, type CompareOp, type Predicate } from '../weather/aggregation/predicate';
import {
  type RequirableMetric,
  derivedMetric,
  isDerivedMetric,
} from '../weather/derived/derived-metric.registry';
import { type MetricCode, type MetricDefinition, isMetricCode, metric } from '../weather/metric';
import type { CanonicalUnit } from '../weather/units';
import type {
  AggregationSpec,
  ConstraintExpr,
  HardConstraint,
  NormalizerSpec,
  ResolvedDefinition,
  ResolvedFeature,
} from './activity-definition';
import {
  type RawConstraint,
  type RawConstraintExpr,
  type RawDeclaration,
  type RawFeature,
  activityDeclarationSchema,
  describeIssues,
  sharedRulesSchema,
} from './activity.schema';
import { applicabilityEntry, isApplicabilityRule } from './applicability.registry';

/**
 * Levels 2 and 3 of docs/development-flow/stage-five.md, section 8, and the
 * resolution that follows: includes expanded, weights normalised.
 *
 * Every fault here stops the start. That is the deliberate trade of
 * design.md: the alternative to a startup failure is a `NaN` reaching a user,
 * and a declaration is never partially applied — three valid declarations do
 * not load beside one broken one.
 */
export interface DeclarationFault {
  /** The declaration at fault, or `(catalogue)` for a fault about the set. */
  readonly activity: string;
  /** Where in it, e.g. `features.gusts.normalizer.params`. */
  readonly path: string;
  readonly message: string;
}

export interface PublishedVersion {
  readonly code: string;
  readonly version: number;
  readonly fingerprint: string;
}

export interface LoadOptions {
  /** Versions already published, which this load may not contradict. */
  readonly published?: readonly PublishedVersion[];
}

const CATALOGUE = '(catalogue)';
const SHARED_PREFIX = 'shared:';

/** The range a value written against this aggregation must fall inside. */
const OUTPUT_UNIT_RANGES: Partial<Record<CanonicalUnit, readonly [number, number]>> = {
  ratio: [0, 1],
  hour: [0, 24],
};

export function loadDeclarations(
  inputs: readonly unknown[],
  sharedRulesInput: unknown,
  options: LoadOptions = {},
): Result<readonly ResolvedDefinition[], readonly DeclarationFault[]> {
  const faults: DeclarationFault[] = [];
  const sharedRules = readSharedRules(sharedRulesInput, faults);
  const resolved: ResolvedDefinition[] = [];

  for (const [index, input] of inputs.entries()) {
    const parsed = activityDeclarationSchema.safeParse(input);

    if (!parsed.success) {
      faults.push({
        activity: nameOf(input) ?? `(declaration ${index})`,
        path: '(shape)',
        message: describeIssues(parsed.error),
      });
      continue;
    }

    const definition = resolveDeclaration(parsed.data, sharedRules, faults);

    if (definition !== undefined) {
      resolved.push(definition);
    }
  }

  checkVersions(resolved, options.published ?? [], faults);

  return faults.length > 0 ? err(faults) : ok(resolved);
}

function nameOf(input: unknown): string | undefined {
  const code = (input as { code?: unknown } | null)?.code;

  return typeof code === 'string' ? code : undefined;
}

function readSharedRules(
  input: unknown,
  faults: DeclarationFault[],
): ReadonlyMap<string, HardConstraint> {
  const parsed = sharedRulesSchema.safeParse(input);

  if (!parsed.success) {
    faults.push({
      activity: CATALOGUE,
      path: 'shared-rules',
      message: describeIssues(parsed.error),
    });

    return new Map();
  }

  const rules = new Map<string, HardConstraint>();

  for (const [id, rule] of Object.entries(parsed.data.rules)) {
    const constraint = readConstraint(rule, `shared-rules.${id}`, CATALOGUE, faults);

    if (constraint !== undefined) {
      rules.set(id, constraint);
    }
  }

  return rules;
}

function resolveDeclaration(
  raw: RawDeclaration,
  sharedRules: ReadonlyMap<string, HardConstraint>,
  faults: DeclarationFault[],
): ResolvedDefinition | undefined {
  const before = faults.length;
  const activity = raw.code;

  const included = raw.include.map((reference) => {
    const id = reference.startsWith(SHARED_PREFIX)
      ? reference.slice(SHARED_PREFIX.length)
      : reference;
    const rule = sharedRules.get(id);

    if (rule === undefined) {
      faults.push({
        activity,
        path: 'include',
        message: `includes the shared rule "${reference}", which the catalogue does not declare`,
      });
    }

    return rule;
  });

  for (const rule of raw.applicability) {
    if (!isApplicabilityRule(rule.rule)) {
      faults.push({
        activity,
        path: `applicability.${rule.rule}`,
        message: `names the applicability rule "${rule.rule}", which is not registered`,
      });
      continue;
    }

    const params = applicabilityEntry(rule.rule).params.safeParse(rule.params ?? {});

    if (!params.success) {
      faults.push({
        activity,
        path: `applicability.${rule.rule}`,
        message: describeIssues(params.error),
      });
    }
  }

  const own = raw.constraints.flatMap((constraint, index) => {
    const read = readConstraint(constraint, `constraints[${index}]`, activity, faults);

    return read === undefined ? [] : [read];
  });

  const features = resolveFeatures(raw, activity, faults);

  if (raw.postprocess !== undefined) {
    const { floor, ceiling } = raw.postprocess;

    if (floor !== undefined && ceiling !== undefined && floor > ceiling) {
      faults.push({
        activity,
        path: 'postprocess',
        message: `declares a floor of ${floor} above its ceiling of ${ceiling}`,
      });
    }
  }

  if (faults.length !== before) {
    return undefined;
  }

  return {
    code: activity,
    version: raw.version,
    titleKey: raw.titleKey,
    applicability: raw.applicability.map((rule) => ({ rule: rule.rule, params: rule.params })),
    // Included rules run before the activity's own, so a cross-cutting refusal
    // is the one reported when both fire (stage-five.md, section 9).
    constraints: [...included.flatMap((rule) => (rule === undefined ? [] : [rule])), ...own],
    features,
    ...(raw.postprocess === undefined ? {} : { postprocess: raw.postprocess }),
    fingerprint: fingerprintOf(raw),
  };
}

function resolveFeatures(
  raw: RawDeclaration,
  activity: string,
  faults: DeclarationFault[],
): readonly ResolvedFeature[] {
  const seen = new Set<string>();
  const read: { raw: RawFeature; role: 'additive' | 'gate' }[] = [];

  for (const feature of raw.features) {
    const path = `features.${feature.id}`;

    if (seen.has(feature.id)) {
      faults.push({
        activity,
        path,
        message: `declares the feature id "${feature.id}" twice; the id addresses the breakdown and must be unique`,
      });
      continue;
    }

    seen.add(feature.id);

    const role = feature.role ?? 'additive';

    checkFeature(feature, role, activity, path, faults);
    read.push({ raw: feature, role });
  }

  const total = read
    .filter((feature) => feature.role === 'additive')
    .reduce((sum, feature) => sum + (feature.raw.weight ?? 0), 0);

  if (total <= 0) {
    faults.push({
      activity,
      path: 'features',
      message: 'has contributing feature weights summing to zero; nothing could be scored from it',
    });

    return [];
  }

  return read.map(({ raw: feature, role }) => ({
    id: featureId(feature.id),
    metric: feature.metric as RequirableMetric,
    unit: feature.unit as CanonicalUnit,
    aggregation: feature.aggregation as AggregationSpec,
    normalizer: feature.normalizer as NormalizerSpec,
    nullPolicy: feature.nullPolicy,
    role,
    // Normalised over the contributing features only, so adding or removing a
    // limiting feature never rescales the others.
    weight: role === 'additive' ? weight((feature.weight ?? 0) / total) : null,
    gateFloor: role === 'gate' ? (clamp01(feature.gateFloor ?? 0) as Score01) : null,
  }));
}

function checkFeature(
  feature: RawFeature,
  role: 'additive' | 'gate',
  activity: string,
  path: string,
  faults: DeclarationFault[],
): void {
  const fault = (message: string, suffix = ''): void => {
    faults.push({ activity, path: `${path}${suffix}`, message });
  };

  if (role === 'additive' && feature.weight === undefined) {
    fault('contributes to the score but declares no weight');
  }

  if (role === 'gate') {
    if (feature.gateFloor === undefined) {
      fault('limits the score but declares no floor to limit it to');
    } else if (feature.gateFloor <= 0 || feature.gateFloor > 1) {
      // A limiting feature that reaches zero is a refusal without a reason,
      // and a refusal must be able to name one.
      fault(
        `declares a limiting floor of ${feature.gateFloor}; it must be above 0 and at most 1, because a score of zero belongs to a constraint that can name its reason`,
      );
    }

    if (feature.weight !== undefined) {
      fault('limits the score and must not also carry a weight');
    }

    if (feature.nullPolicy === 'fail') {
      fault('limits the score, so the null policy "fail" cannot apply to it');
    }
  }

  const resolvedMetric = checkMetric(feature.metric, feature.unit, activity, path, faults);
  const aggregation = checkAggregation(feature.aggregation, resolvedMetric, activity, path, faults);

  checkNormalizer(feature.normalizer, resolvedMetric, aggregation, activity, path, faults);
}

interface ResolvedMetricMeta {
  readonly code: RequirableMetric;
  readonly unit: CanonicalUnit;
  readonly plausible: readonly [number, number] | undefined;
  readonly granularity: MetricDefinition['granularity'];
  readonly categorical: boolean;
}

function checkMetric(
  code: string,
  declaredUnit: string,
  activity: string,
  path: string,
  faults: DeclarationFault[],
): ResolvedMetricMeta | undefined {
  const meta = metaOf(code);

  if (meta === undefined) {
    faults.push({
      activity,
      path: `${path}.metric`,
      message: `reads "${code}", which is neither in the metric dictionary nor a derived metric`,
    });

    return undefined;
  }

  if (declaredUnit !== meta.unit) {
    // The restatement is redundant against the dictionary on purpose: it is
    // the half of the unit check that makes the author's intent explicit
    // (design.md, Decision 9).
    faults.push({
      activity,
      path: `${path}.unit`,
      message: `declares "${code}" in ${declaredUnit}, but the metric is carried in ${meta.unit}`,
    });

    return undefined;
  }

  if (meta.plausible === undefined) {
    faults.push({
      activity,
      path: `${path}.metric`,
      message: `reads "${code}", which carries no number and cannot be scored`,
    });

    return undefined;
  }

  return meta;
}

function metaOf(code: string): ResolvedMetricMeta | undefined {
  if (isDerivedMetric(code)) {
    const derived = derivedMetric(code);

    return {
      code,
      unit: derived.unit,
      plausible: plausibleForDerived(derived.code),
      granularity: 'hourly',
      categorical: false,
    };
  }

  if (!isMetricCode(code)) {
    return undefined;
  }

  const definition = metric(code as MetricCode);

  return {
    code,
    unit: definition.canonicalUnit,
    plausible: definition.plausible,
    granularity: definition.granularity,
    categorical: definition.kind === 'categorical',
  };
}

/**
 * A derived metric's range follows from what it is: an angle between two
 * bearings, snow that fell below freezing, a height difference.
 */
function plausibleForDerived(code: string): readonly [number, number] {
  switch (code) {
    case 'WIND_WAVE_ALIGNMENT':
      return [0, 180];
    case 'FRESH_COLD_SNOWFALL':
      return [0, 300];
    default:
      return [-6000, 6000];
  }
}

function checkAggregation(
  spec: { type: string; params?: unknown },
  meta: ResolvedMetricMeta | undefined,
  activity: string,
  path: string,
  faults: DeclarationFault[],
): AggregatorEntry | undefined {
  const entry = aggregatorRegistry.get(spec.type);

  if (entry === undefined) {
    faults.push({
      activity,
      path: `${path}.aggregation`,
      message: `uses the aggregation "${spec.type}", which is not registered`,
    });

    return undefined;
  }

  const params = entry.params.safeParse(spec.params ?? {});

  if (!params.success) {
    faults.push({
      activity,
      path: `${path}.aggregation.params`,
      message: `${spec.type}: ${describeIssues(params.error)}`,
    });

    return undefined;
  }

  if (meta !== undefined) {
    checkPredicateParams(params.data, meta, activity, `${path}.aggregation.params`, faults);
  }

  if (meta !== undefined && !servesChannel(meta.granularity, entry.granularity)) {
    faults.push({
      activity,
      path: `${path}.aggregation`,
      message: `uses "${spec.type}", which reads the ${entry.granularity} channel, over "${meta.code}", which the provider serves ${meta.granularity}`,
    });

    return undefined;
  }

  return entry;
}

/**
 * A predicate inside `shareOfHours` or `countIf` compares the metric's own raw
 * values, so its thresholds are measured against the metric's own range and
 * not against the unit the aggregation answers in. Nothing downstream would
 * catch a mistake here: a visibility threshold of 5000 metres in a field
 * carried in kilometres simply reports a share of 1.0 every day.
 */
function checkPredicateParams(
  params: unknown,
  meta: ResolvedMetricMeta,
  activity: string,
  path: string,
  faults: DeclarationFault[],
): void {
  const predicate = (params as { predicate?: unknown } | undefined)?.predicate;

  if (predicate !== undefined) {
    walkPredicate(predicate as Predicate, meta, activity, path, faults);
  }
}

function walkPredicate(
  predicate: Predicate,
  meta: ResolvedMetricMeta,
  activity: string,
  path: string,
  faults: DeclarationFault[],
): void {
  if ('anyOf' in predicate) {
    predicate.anyOf.forEach((branch) => walkPredicate(branch, meta, activity, path, faults));

    return;
  }

  if ('allOf' in predicate) {
    predicate.allOf.forEach((branch) => walkPredicate(branch, meta, activity, path, faults));

    return;
  }

  if ('not' in predicate) {
    walkPredicate(predicate.not, meta, activity, path, faults);

    return;
  }

  const setOp = predicate.op === 'in' || predicate.op === 'notIn';

  if (meta.categorical && !setOp) {
    faults.push({
      activity,
      path,
      message: `compares the categorical metric "${meta.code}" by magnitude with "${predicate.op}"; a code is a category, so only "in" and "notIn" apply`,
    });
  }

  if (meta.plausible === undefined) {
    return;
  }

  const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value as number];

  for (const value of values) {
    if (value < meta.plausible[0] || value > meta.plausible[1]) {
      faults.push({
        activity,
        path,
        message: `tests "${meta.code}" against ${value}, outside its plausible range [${meta.plausible[0]}, ${meta.plausible[1]}] in ${meta.unit}`,
      });
    }
  }
}

function servesChannel(
  granularity: MetricDefinition['granularity'],
  needed: 'hourly' | 'daily',
): boolean {
  return granularity === 'both' || granularity === needed;
}

function checkNormalizer(
  spec: { type: string; params?: unknown },
  meta: ResolvedMetricMeta | undefined,
  aggregation: AggregatorEntry | undefined,
  activity: string,
  path: string,
  faults: DeclarationFault[],
): void {
  const entry = normalizerRegistry.get(spec.type);

  if (entry === undefined) {
    faults.push({
      activity,
      path: `${path}.normalizer`,
      message: `uses the normalizer "${spec.type}", which is not registered`,
    });

    return;
  }

  const params = entry.params.safeParse(spec.params ?? {});

  if (!params.success) {
    faults.push({
      activity,
      path: `${path}.normalizer.params`,
      message: `${spec.type}: ${describeIssues(params.error)}`,
    });

    return;
  }

  if (meta === undefined || aggregation === undefined) {
    return;
  }

  const range = rangeFor(meta, aggregation);

  if (range === undefined) {
    return;
  }

  for (const point of entry.axisPoints(params.data)) {
    if (point < range[0] || point > range[1]) {
      faults.push({
        activity,
        path: `${path}.normalizer.params`,
        message: `puts a curve point at ${point}, outside the plausible range [${range[0]}, ${range[1]}] of "${meta.code}" in ${unitAfter(meta, aggregation)}`,
      });
    }
  }
}

/**
 * The range a threshold is measured against. When the aggregation answers in a
 * unit of its own — a share, a count of hours — the metric's own range says
 * nothing about it, and that unit's range applies instead.
 */
function rangeFor(
  meta: ResolvedMetricMeta,
  aggregation: AggregatorEntry,
): readonly [number, number] | undefined {
  return aggregation.outputUnit === 'same'
    ? meta.plausible
    : OUTPUT_UNIT_RANGES[aggregation.outputUnit];
}

function unitAfter(meta: ResolvedMetricMeta, aggregation: AggregatorEntry): CanonicalUnit {
  return aggregation.outputUnit === 'same' ? meta.unit : aggregation.outputUnit;
}

function readConstraint(
  raw: RawConstraint,
  path: string,
  activity: string,
  faults: DeclarationFault[],
): HardConstraint | undefined {
  const before = faults.length;

  if (!isReasonCode(raw.reason)) {
    faults.push({
      activity,
      path: `${path}.reason`,
      message: `names the reason "${raw.reason}", which is not in the reason registry`,
    });
  }

  const when = readExpr(raw.when, `${path}.when`, activity, faults);

  if (faults.length !== before || when === undefined || !isReasonCode(raw.reason)) {
    return undefined;
  }

  return { reason: raw.reason, when };
}

function readExpr(
  raw: RawConstraintExpr,
  path: string,
  activity: string,
  faults: DeclarationFault[],
): ConstraintExpr | undefined {
  if ('anyOf' in raw) {
    const branches = raw.anyOf.map((branch, index) =>
      readExpr(branch, `${path}.anyOf[${index}]`, activity, faults),
    );

    return branches.every((branch) => branch !== undefined) ? { anyOf: branches } : undefined;
  }

  if ('allOf' in raw) {
    const branches = raw.allOf.map((branch, index) =>
      readExpr(branch, `${path}.allOf[${index}]`, activity, faults),
    );

    return branches.every((branch) => branch !== undefined) ? { allOf: branches } : undefined;
  }

  if ('not' in raw) {
    const inner = readExpr(raw.not, `${path}.not`, activity, faults);

    return inner === undefined ? undefined : { not: inner };
  }

  const before = faults.length;
  const meta = checkMetric(raw.metric, raw.unit, activity, path, faults);
  const aggregation = checkAggregation(raw.aggregation, meta, activity, path, faults);

  if (!(COMPARE_OPS as readonly string[]).includes(raw.op)) {
    faults.push({
      activity,
      path: `${path}.op`,
      message: `compares with "${raw.op}", which is not one of ${COMPARE_OPS.join(', ')}`,
    });
  }

  const setOp = raw.op === 'in' || raw.op === 'notIn';

  if (setOp !== Array.isArray(raw.value)) {
    faults.push({
      activity,
      path: `${path}.value`,
      message: `uses "${raw.op}" with ${Array.isArray(raw.value) ? 'a set of values' : 'a single value'}`,
    });
  }

  if (meta !== undefined && aggregation !== undefined) {
    checkConstraintValue(raw, meta, aggregation, path, activity, faults);
  }

  if (faults.length !== before || meta === undefined) {
    return undefined;
  }

  return {
    metric: meta.code,
    unit: meta.unit,
    aggregation: raw.aggregation as AggregationSpec,
    op: raw.op as CompareOp,
    value: raw.value,
  };
}

function checkConstraintValue(
  raw: { op: string; value: number | readonly number[] },
  meta: ResolvedMetricMeta,
  aggregation: AggregatorEntry,
  path: string,
  activity: string,
  faults: DeclarationFault[],
): void {
  const setOp = raw.op === 'in' || raw.op === 'notIn';

  if (meta.categorical && aggregation.outputUnit === 'same' && !setOp) {
    faults.push({
      activity,
      path: `${path}.op`,
      message: `compares the categorical metric "${meta.code}" by magnitude with "${raw.op}"; a code is a category, so only "in" and "notIn" apply`,
    });
  }

  const range = rangeFor(meta, aggregation);

  if (range === undefined) {
    return;
  }

  for (const value of Array.isArray(raw.value) ? raw.value : [raw.value as number]) {
    if (value < range[0] || value > range[1]) {
      faults.push({
        activity,
        path: `${path}.value`,
        message: `compares against ${value}, outside the plausible range [${range[0]}, ${range[1]}] of "${meta.code}" in ${unitAfter(meta, aggregation)}`,
      });
    }
  }
}

function checkVersions(
  resolved: readonly ResolvedDefinition[],
  published: readonly PublishedVersion[],
  faults: DeclarationFault[],
): void {
  const seen = new Map<string, string>();

  for (const entry of published) {
    seen.set(`${entry.code}@${entry.version}`, entry.fingerprint);
  }

  const inThisLoad = new Set<string>();

  for (const definition of resolved) {
    const key = `${definition.code}@${definition.version}`;

    // Two entries under one key is a collision whatever they contain: the
    // catalogue could only keep one of them, and silently keeping the last is
    // how a rule change disappears.
    if (inThisLoad.has(key)) {
      faults.push({
        activity: definition.code,
        path: 'version',
        message: `is declared twice at version ${definition.version}; one version is one declaration`,
      });
      continue;
    }

    inThisLoad.add(key);

    const known = seen.get(key);

    if (known === undefined) {
      seen.set(key, definition.fingerprint);
      continue;
    }

    if (known !== definition.fingerprint) {
      faults.push({
        activity: definition.code,
        path: 'version',
        message: `redefines version ${definition.version} with different content; a published version is immutable and a change is a new version`,
      });
    }
  }
}

/**
 * A stable digest of the declaration. Key order is normalised so that
 * reformatting a seed file is not mistaken for a rule change.
 */
export function fingerprintOf(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${hash.toString(16).padStart(8, '0')}-${text.length.toString(16)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}
