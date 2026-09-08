import { describe, expect, expectTypeOf, it } from 'vitest';

import { clamp01, toScore100 } from '../shared/branded';
import { REASON } from '../shared/reason-code';
import {
  type ActivityOutcome,
  type Inapplicable,
  type MissingData,
  type Ranked,
  reasonOf,
  scoreOf,
} from './activity-outcome';

const zeroed: Ranked = {
  kind: 'ranked',
  score: toScore100(clamp01(0)),
  constraintViolated: 'NO_SNOW_COVER',
  breakdown: [],
  definitionVersion: 1,
  profileId: 'default',
  profileVersion: 1,
};

const inapplicable: Inapplicable = { kind: 'not_applicable', reason: 'NO_COASTLINE_NEARBY' };

const missing: MissingData = {
  kind: 'no_data',
  reason: 'MARINE_UNAVAILABLE',
  missingMetrics: ['wave_height'],
  retryable: true,
};

describe('the three outcomes an activity can have', () => {
  it('gives an inapplicable outcome no score field to read', () => {
    expectTypeOf<Inapplicable>().not.toHaveProperty('score');
    expectTypeOf<MissingData>().not.toHaveProperty('score');
    expect(scoreOf(inapplicable)).toBeNull();
    expect(scoreOf(missing)).toBeNull();
    expect(Object.hasOwn(inapplicable, 'score')).toBe(false);
  });

  it('keeps a ranked zero a score, not a refusal', () => {
    expect(zeroed.kind).toBe('ranked');
    expect(scoreOf(zeroed)).toBe(0);
    // The two states are not interchangeable in either direction: a refusal
    // has no score to read, and a zero has no reason field a refusal would
    // recognise.
    expect(zeroed.kind).not.toBe(inapplicable.kind);
  });

  it('makes a ranked zero name the constraint that zeroed it', () => {
    expect(zeroed.constraintViolated).toBe('NO_SNOW_COVER');
    expect(REASON[zeroed.constraintViolated ?? 'NO_SNOW_COVER'].kind).toBe('constraint');
  });

  it('draws each outcome kind from the reason registry rather than from free text', () => {
    expect(REASON[inapplicable.reason].kind).toBe('not_applicable');
    expect(REASON[missing.reason].kind).toBe('no_data');
    expectTypeOf<Inapplicable['reason']>().not.toEqualTypeOf<string>();
  });

  it('reads the reason of whichever outcome carries one, and none from a plain score', () => {
    const scored: ActivityOutcome = { ...zeroed, score: toScore100(clamp01(0.82)) };
    delete (scored as { constraintViolated?: unknown }).constraintViolated;

    expect(reasonOf(zeroed)).toBe('NO_SNOW_COVER');
    expect(reasonOf(inapplicable)).toBe('NO_COASTLINE_NEARBY');
    expect(reasonOf(missing)).toBe('MARINE_UNAVAILABLE');
    expect(reasonOf(scored)).toBeUndefined();
  });

  it('says whether retrying may help only where that is a fact about the data', () => {
    expect(missing.retryable).toBe(true);
    expect(REASON.TOO_MANY_GAPS.retryable).toBe(false);
    expectTypeOf<Ranked>().not.toHaveProperty('retryable');
  });
});
