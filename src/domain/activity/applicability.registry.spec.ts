import { describe, expect, it } from 'vitest';

import { APPLICABILITY_RULES, applicabilityEntry, isApplicabilityRule } from './applicability.registry';

describe('the applicability registry', () => {
  it('holds the two rules the four activities name', () => {
    expect(Object.keys(APPLICABILITY_RULES).toSorted()).toEqual(['marineCoverage', 'snowSeason']);
  });

  it('validates a rule reference against that rule own parameter schema', () => {
    const snowSeason = applicabilityEntry('snowSeason');

    expect(snowSeason.params.safeParse({ minColdMonthSnowfallCm: 20 }).success).toBe(true);
    expect(snowSeason.params.safeParse({ minColdMonthSnowfallCm: 'twenty' }).success).toBe(false);
    expect(snowSeason.params.safeParse({}).success).toBe(false);
  });

  it('names each rule for the condition it tests, never for an activity', () => {
    // `snowSeason`, not `skiApplicable`: the rule is a property of the place,
    // and a second snow activity must be able to name the same one.
    for (const code of Object.keys(APPLICABILITY_RULES)) {
      expect(code.toLowerCase()).not.toMatch(/ski|surf|sightseeing/);
    }
  });

  it('refuses a rule nobody registered', () => {
    expect(isApplicabilityRule('snowSeason')).toBe(true);
    expect(isApplicabilityRule('altitudeAbove')).toBe(false);
  });
});
