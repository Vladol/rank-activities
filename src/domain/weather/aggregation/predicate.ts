import { z } from 'zod';

/**
 * One predicate tree, used by both the aggregations that count hours and the
 * hard constraints (docs/development-flow/stage-five.md, section 3). Sharing it
 * is the point: two condition formats drift apart by the third month.
 *
 * `in` is the only reason a WMO code may take part in a calculation at all. A
 * code is a category, not a magnitude, and `in [95, 96]` answers "was there a
 * thunderstorm" without ever comparing 97 against 95
 * (docs/development-flow/stage-three.md, section 3.5).
 */
export const COMPARE_OPS = ['lt', 'lte', 'gt', 'gte', 'eq', 'ne', 'in', 'notIn'] as const;

export type CompareOp = (typeof COMPARE_OPS)[number];

export type Predicate =
  | { readonly op: CompareOp; readonly value: number | readonly number[] }
  | { readonly anyOf: readonly Predicate[] }
  | { readonly allOf: readonly Predicate[] }
  | { readonly not: Predicate };

const SET_OPS: readonly CompareOp[] = ['in', 'notIn'];

const comparisonSchema = z
  .object({
    op: z.enum(COMPARE_OPS),
    value: z.union([z.number(), z.array(z.number()).min(1)]),
  })
  .refine(
    (node) => SET_OPS.includes(node.op) === Array.isArray(node.value),
    'in and notIn take a set of values; every other operator takes one value',
  );

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    comparisonSchema,
    z.object({ anyOf: z.array(predicateSchema).min(1) }),
    z.object({ allOf: z.array(predicateSchema).min(1) }),
    z.object({ not: predicateSchema }),
  ]),
) as z.ZodType<Predicate>;

export function evaluatePredicate(predicate: Predicate, value: number): boolean {
  if ('anyOf' in predicate) {
    return predicate.anyOf.some((branch) => evaluatePredicate(branch, value));
  }

  if ('allOf' in predicate) {
    return predicate.allOf.every((branch) => evaluatePredicate(branch, value));
  }

  if ('not' in predicate) {
    return !evaluatePredicate(predicate.not, value);
  }

  return compare(predicate.op, predicate.value, value);
}

function compare(op: CompareOp, threshold: number | readonly number[], value: number): boolean {
  if (op === 'in' || op === 'notIn') {
    const members = Array.isArray(threshold) ? threshold : [threshold as number];
    const found = members.includes(value);

    return op === 'in' ? found : !found;
  }

  if (Array.isArray(threshold)) {
    return false;
  }

  const bound = threshold as number;

  switch (op) {
    case 'lt':
      return value < bound;
    case 'lte':
      return value <= bound;
    case 'gt':
      return value > bound;
    case 'gte':
      return value >= bound;
    case 'eq':
      return value === bound;
    case 'ne':
      return value !== bound;
  }
}
