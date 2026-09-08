import { z } from 'zod';

/**
 * Level 1 of docs/development-flow/stage-five.md, section 8: the *shape* of a
 * declaration — required fields, types, ranges.
 *
 * What this schema deliberately does **not** do is list the legal normalizer,
 * aggregation, metric or rule names. Those come from the registries, and are
 * checked in `declaration.load.ts` by asking the registry entry itself. A
 * second list of names here is the drift design.md Decision 1 rejects: a new
 * curve would have to be added twice, and the second place is the one that
 * gets forgotten.
 *
 * It also buys better messages. A discriminated union over six curve schemas
 * reports "no matching discriminator"; asking the registry reports the curve
 * the author actually wrote.
 */
const specSchema = z.object({ type: z.string().min(1), params: z.unknown().optional() });

const featureSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['additive', 'gate']).optional(),
  metric: z.string().min(1),
  unit: z.string().min(1),
  aggregation: specSchema,
  normalizer: specSchema,
  weight: z.number().finite().nonnegative().optional(),
  gateFloor: z.number().finite().optional(),
  nullPolicy: z.enum(['degrade', 'exclude', 'fail']),
});

export type RawFeature = z.infer<typeof featureSchema>;

const leafSchema = z.object({
  metric: z.string().min(1),
  unit: z.string().min(1),
  aggregation: specSchema,
  op: z.string().min(1),
  value: z.union([z.number().finite(), z.array(z.number().finite()).min(1)]),
});

export type RawConstraintExpr =
  | z.infer<typeof leafSchema>
  | { anyOf: RawConstraintExpr[] }
  | { allOf: RawConstraintExpr[] }
  | { not: RawConstraintExpr };

export const constraintExprSchema: z.ZodType<RawConstraintExpr> = z.lazy(() =>
  z.union([
    leafSchema,
    z.object({ anyOf: z.array(constraintExprSchema).min(1) }),
    z.object({ allOf: z.array(constraintExprSchema).min(1) }),
    z.object({ not: constraintExprSchema }),
  ]),
) as z.ZodType<RawConstraintExpr>;

const constraintSchema = z.object({ reason: z.string().min(1), when: constraintExprSchema });

export type RawConstraint = z.infer<typeof constraintSchema>;

export const activityDeclarationSchema = z.object({
  code: z.string().min(1),
  version: z.number().int().positive(),
  titleKey: z.string().min(1),
  include: z.array(z.string().min(1)).default([]),
  applicability: z
    .array(z.object({ rule: z.string().min(1), params: z.unknown().optional() }))
    .default([]),
  constraints: z.array(constraintSchema).default([]),
  features: z.array(featureSchema).min(1),
  postprocess: z
    .object({
      floor: z.number().min(0).max(100).optional(),
      ceiling: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export type RawDeclaration = z.infer<typeof activityDeclarationSchema>;

export const sharedRulesSchema = z.object({
  version: z.number().int().positive(),
  rules: z.record(z.string().min(1), constraintSchema),
});

export type RawSharedRules = z.infer<typeof sharedRulesSchema>;

/** Turns a zod failure into lines a startup message can name a field with. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
