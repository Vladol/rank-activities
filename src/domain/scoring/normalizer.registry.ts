import { z } from 'zod';

import type { Score01 } from '../shared/branded';
import { type RegistryEntry, indexByCode } from '../shared/registry';
import { type GaussianParams, gaussian } from './normalizers/gaussian';
import { type InverseParams, inverse } from './normalizers/inverse';
import { inverseGaussian } from './normalizers/inverse-gaussian';
import { type LinearParams, linear } from './normalizers/linear';
import { type StepParams, step } from './normalizers/step';
import { type TrapezoidParams, trapezoid } from './normalizers/trapezoid';

/**
 * The registry of docs/development-flow/stage-five.md, section 2. Each entry
 * carries its own parameter schema, so the declaration schema is assembled from
 * the registry and a new curve becomes a legal JSON value the moment it is
 * added here (design.md, Decision 1).
 *
 * `monotonic` is a declared property, not documentation: a property-based test
 * runs pairs `v1 < v2` through the curve and requires the declared direction.
 * A swapped `from`/`to` is caught there rather than by a reviewer's eye.
 */
export type Monotonicity = 'asc' | 'desc' | 'none';

export interface NormalizerEntry extends RegistryEntry {
  readonly code: NormalizerCode;
  readonly params: z.ZodType;
  readonly monotonic: Monotonicity;
  /**
   * The parameters that are points on the metric's own axis, written in the
   * metric's unit. They are what the plausible-range check reads
   * (stage-five.md, section 8). A width such as a bell's sigma is not one of
   * them: a range over the axis says nothing about a spread.
   */
  readonly axisPoints: (params: unknown) => readonly number[];
  readonly fn: (value: number, params: unknown) => Score01;
}

/**
 * Erases the parameter type at the registry boundary, in one place. Parameters
 * arrive from JSON as `unknown` and are narrowed by the entry's own schema at
 * load time; past that point this cast is the record of that check.
 */
function entry<P>(definition: {
  readonly code: NormalizerCode;
  readonly params: z.ZodType<P>;
  readonly monotonic: Monotonicity;
  readonly axisPoints: (params: P) => readonly number[];
  readonly fn: (value: number, params: P) => Score01;
}): NormalizerEntry {
  return {
    code: definition.code,
    params: definition.params as z.ZodType,
    monotonic: definition.monotonic,
    axisPoints: (params) => definition.axisPoints(params as P),
    fn: (value, params) => definition.fn(value, params as P),
  };
}

const linearParams = z
  .object({ from: z.number(), to: z.number() })
  .refine((params) => params.from !== params.to, 'from must differ from to');

const bellParams = z.object({ center: z.number(), sigma: z.number().positive() });

const trapezoidParams = z
  .object({ a: z.number(), b: z.number(), c: z.number(), d: z.number() })
  .refine((p) => p.a <= p.b && p.b <= p.c && p.c <= p.d, 'a <= b <= c <= d must hold');

const stepParams = z
  .object({
    points: z.array(z.object({ at: z.number(), value: z.number().min(0).max(1) })).min(1),
    below: z.number().min(0).max(1),
  })
  .refine(
    (p) => p.points.every((point, index) => index === 0 || point.at > (p.points[index - 1]?.at ?? 0)),
    'points must ascend by "at"',
  );

export const NORMALIZER_CODES = [
  'linear',
  'inverse',
  'trapezoid',
  'gaussian',
  'inverseGaussian',
  'step',
] as const;

export type NormalizerCode = (typeof NORMALIZER_CODES)[number];

export const NORMALIZERS: readonly NormalizerEntry[] = [
  entry<LinearParams>({
    code: 'linear',
    params: linearParams,
    monotonic: 'asc',
    axisPoints: (p) => [p.from, p.to],
    fn: linear,
  }),
  entry<InverseParams>({
    code: 'inverse',
    params: linearParams,
    monotonic: 'desc',
    axisPoints: (p) => [p.from, p.to],
    fn: inverse,
  }),
  entry<TrapezoidParams>({
    code: 'trapezoid',
    params: trapezoidParams,
    monotonic: 'none',
    axisPoints: (p) => [p.a, p.b, p.c, p.d],
    fn: trapezoid,
  }),
  entry<GaussianParams>({
    code: 'gaussian',
    params: bellParams,
    monotonic: 'none',
    axisPoints: (p) => [p.center],
    fn: gaussian,
  }),
  entry<GaussianParams>({
    code: 'inverseGaussian',
    params: bellParams,
    monotonic: 'none',
    axisPoints: (p) => [p.center],
    fn: inverseGaussian,
  }),
  entry<StepParams>({
    code: 'step',
    params: stepParams,
    monotonic: 'none',
    axisPoints: (p) => p.points.map((point) => point.at),
    fn: step,
  }),
];

export const normalizerRegistry = indexByCode('normalizer', NORMALIZERS);

export function isNormalizerCode(value: string): value is NormalizerCode {
  return normalizerRegistry.has(value);
}

export function normalizerEntry(code: NormalizerCode): NormalizerEntry {
  const found = normalizerRegistry.get(code);

  if (found === undefined) {
    throw new Error(`No normalizer is registered under "${code}".`);
  }

  return found;
}
