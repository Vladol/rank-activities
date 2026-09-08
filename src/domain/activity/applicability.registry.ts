import { z } from 'zod';

/**
 * The rules that gate *where* an activity is offered, by name and by parameter
 * schema. Deciding them is `04-add-location-applicability`; what belongs here
 * is the vocabulary a declaration may refer to, so that a typo in a rule name
 * stops the start instead of silently ungating an activity.
 *
 * A rule is named for the condition it tests. `snowSeason`, never
 * `skiApplicable`: the condition is a property of the place, and a second snow
 * activity has to be able to name the same rule.
 */
export const APPLICABILITY_RULES = {
  /**
   * A cold month whose archived snowfall clears the threshold
   * (docs/development-flow/stage-five.md, section 5.1). Deliberately not a
   * test on elevation: Quito sees no snow at 2850 m and Tromso skis from
   * nearly sea level.
   */
  snowSeason: {
    code: 'snowSeason',
    params: z.object({ minColdMonthSnowfallCm: z.number().positive() }),
  },
  /**
   * The two-phase marine probe of stage-three.md, section 5.1. Until the second
   * probe confirms, the honest answer is NoData rather than NotApplicable.
   */
  marineCoverage: {
    code: 'marineCoverage',
    params: z.object({ confirmations: z.number().int().positive() }),
  },
} as const satisfies Record<string, { code: string; params: z.ZodType }>;

export type ApplicabilityRuleCode = keyof typeof APPLICABILITY_RULES;

export interface ApplicabilityEntry {
  readonly code: string;
  readonly params: z.ZodType;
}

export function isApplicabilityRule(value: string): value is ApplicabilityRuleCode {
  return Object.hasOwn(APPLICABILITY_RULES, value);
}

export function applicabilityEntry(code: ApplicabilityRuleCode): ApplicabilityEntry {
  return APPLICABILITY_RULES[code];
}
