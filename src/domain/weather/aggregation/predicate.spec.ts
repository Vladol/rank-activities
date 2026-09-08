import { describe, expect, it } from 'vitest';

import { type Predicate, evaluatePredicate, predicateSchema } from './predicate';

describe('the comparison operators', () => {
  it.each([
    ['lt', 0.1, 0.05, true],
    ['lt', 0.1, 0.1, false],
    ['lte', 0.1, 0.1, true],
    ['gt', 25, 26, true],
    ['gt', 25, 25, false],
    ['gte', 25, 25, true],
    ['eq', 0, 0, true],
    ['ne', 0, 0, false],
  ] as const)('%s %s against %s is %s', (op, threshold, value, expected) => {
    expect(evaluatePredicate({ op, value: threshold }, value)).toBe(expected);
  });
});

describe('membership over WMO codes', () => {
  // A WMO code is a category, not a number to do arithmetic on
  // (docs/development-flow/stage-three.md, section 3.5).
  const thunderstorm: Predicate = { op: 'in', value: [95, 96] };

  it('matches only the codes listed', () => {
    expect(evaluatePredicate(thunderstorm, 95)).toBe(true);
    expect(evaluatePredicate(thunderstorm, 96)).toBe(true);
  });

  it('never compares codes by magnitude', () => {
    // 97 and 99 sit above 95 numerically and are not in the set. A magnitude
    // comparison would report both as thunderstorms.
    expect(evaluatePredicate(thunderstorm, 97)).toBe(false);
    expect(evaluatePredicate(thunderstorm, 99)).toBe(false);
    expect(evaluatePredicate(thunderstorm, 3)).toBe(false);
  });

  it('inverts with notIn', () => {
    expect(evaluatePredicate({ op: 'notIn', value: [95, 96] }, 97)).toBe(true);
    expect(evaluatePredicate({ op: 'notIn', value: [95, 96] }, 95)).toBe(false);
  });
});

describe('the composite operators', () => {
  it('takes anyOf as a disjunction', () => {
    const stormy: Predicate = { anyOf: [{ op: 'in', value: [95, 96] }, { op: 'gte', value: 25 }] };

    expect(evaluatePredicate(stormy, 96)).toBe(true);
    expect(evaluatePredicate(stormy, 30)).toBe(true);
    expect(evaluatePredicate(stormy, 3)).toBe(false);
  });

  it('takes allOf as a conjunction', () => {
    const mild: Predicate = { allOf: [{ op: 'gte', value: 15 }, { op: 'lte', value: 25 }] };

    expect(evaluatePredicate(mild, 20)).toBe(true);
    expect(evaluatePredicate(mild, 30)).toBe(false);
  });

  it('negates with not', () => {
    expect(evaluatePredicate({ not: { op: 'lt', value: 0.1 } }, 0.5)).toBe(true);
    expect(evaluatePredicate({ not: { op: 'lt', value: 0.1 } }, 0.05)).toBe(false);
  });

  it('nests to any depth', () => {
    const nested: Predicate = {
      allOf: [{ not: { op: 'in', value: [95, 96] } }, { anyOf: [{ op: 'lt', value: 3 }] }],
    };

    expect(evaluatePredicate(nested, 2)).toBe(true);
    expect(evaluatePredicate(nested, 95)).toBe(false);
  });
});

describe('the predicate schema', () => {
  it('accepts the shapes the seeds use', () => {
    expect(predicateSchema.safeParse({ op: 'lt', value: 0.1 }).success).toBe(true);
    expect(predicateSchema.safeParse({ op: 'in', value: [95, 96] }).success).toBe(true);
    expect(predicateSchema.safeParse({ anyOf: [{ op: 'gte', value: 25 }] }).success).toBe(true);
  });

  it('refuses a set where a scalar belongs and a scalar where a set belongs', () => {
    expect(predicateSchema.safeParse({ op: 'lt', value: [1, 2] }).success).toBe(false);
    expect(predicateSchema.safeParse({ op: 'in', value: 95 }).success).toBe(false);
  });

  it('refuses an unknown operator and an empty composite', () => {
    expect(predicateSchema.safeParse({ op: 'approximately', value: 1 }).success).toBe(false);
    expect(predicateSchema.safeParse({ anyOf: [] }).success).toBe(false);
  });
});
