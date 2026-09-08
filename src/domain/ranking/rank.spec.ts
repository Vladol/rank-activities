import { describe, expect, it } from 'vitest';

import { clamp01, toScore100 } from '../shared/branded';
import type { ActivityOutcome } from './activity-outcome';
import { type ActivityResult, rankDay } from './rank';

const score = (value: number): ActivityOutcome => ({
  kind: 'ranked',
  score: toScore100(clamp01(value / 100)),
  breakdown: [],
  definitionVersion: 1,
  profileId: 'default',
  profileVersion: 1,
});

const zeroed: ActivityOutcome = {
  kind: 'ranked',
  score: toScore100(clamp01(0)),
  constraintViolated: 'NO_SNOW_COVER',
  breakdown: [],
  definitionVersion: 1,
  profileId: 'default',
  profileVersion: 1,
};

const inapplicable: ActivityOutcome = { kind: 'not_applicable', reason: 'NO_COASTLINE_NEARBY' };

const missing: ActivityOutcome = {
  kind: 'no_data',
  reason: 'MARINE_UNAVAILABLE',
  missingMetrics: ['wave_height'],
  retryable: true,
};

const result = (activity: string, outcome: ActivityOutcome): ActivityResult => ({
  activity,
  outcome,
});

describe('ordering one day of outcomes', () => {
  it('orders the ranked results by descending score', () => {
    const day = rankDay([
      result('indoor-sightseeing', score(45)),
      result('surfing', score(82)),
      result('outdoor-sightseeing', score(74)),
    ]);

    expect(day.ranked.map((entry) => entry.activity)).toEqual([
      'surfing',
      'outdoor-sightseeing',
      'indoor-sightseeing',
    ]);
  });

  it('breaks a tie by the activity code, whatever order the input arrived in', () => {
    const tied = [
      result('surfing', score(60)),
      result('indoor-sightseeing', score(60)),
      result('outdoor-sightseeing', score(60)),
    ];

    expect(rankDay(tied).ranked.map((entry) => entry.activity)).toEqual([
      'indoor-sightseeing',
      'outdoor-sightseeing',
      'surfing',
    ]);
    expect(rankDay(tied.toReversed()).ranked.map((entry) => entry.activity)).toEqual([
      'indoor-sightseeing',
      'outdoor-sightseeing',
      'surfing',
    ]);
  });

  it('gives a tied input the same order on every evaluation', () => {
    const tied = [
      result('surfing', score(60)),
      result('ski', score(60)),
      result('indoor-sightseeing', score(60)),
      result('outdoor-sightseeing', score(60)),
    ];
    const orders = Array.from({ length: 50 }, () =>
      rankDay(tied).ranked.map((entry) => entry.activity).join(','),
    );

    expect(new Set(orders).size).toBe(1);
  });

  it('keeps a ranked zero among the ranked results, last of them', () => {
    const day = rankDay([result('ski', zeroed), result('outdoor-sightseeing', score(30))]);

    expect(day.ranked.map((entry) => entry.activity)).toEqual(['outdoor-sightseeing', 'ski']);
    expect(day.notRanked).toEqual([]);
  });

  it('excludes the non-scored outcomes from the ordering and groups them after', () => {
    const day = rankDay([
      result('surfing', inapplicable),
      result('outdoor-sightseeing', score(10)),
      result('ski', missing),
    ]);

    expect(day.ranked.map((entry) => entry.activity)).toEqual(['outdoor-sightseeing']);
    expect(day.notRanked.map((entry) => entry.activity)).toEqual(['ski', 'surfing']);
  });

  it('does not sort a non-scored outcome as though it were a zero', () => {
    // "There is no sea here" is not a worse day at the beach than a flat one;
    // an inapplicable result must not land beside a ranked zero.
    const day = rankDay([result('surfing', inapplicable), result('ski', zeroed)]);

    expect(day.ranked.map((entry) => entry.activity)).toEqual(['ski']);
    expect(day.notRanked.map((entry) => entry.activity)).toEqual(['surfing']);
  });

  it('orders the non-scored group deterministically too', () => {
    const results = [result('surfing', missing), result('ski', inapplicable)];

    expect(rankDay(results).notRanked.map((entry) => entry.activity)).toEqual(['ski', 'surfing']);
    expect(rankDay(results.toReversed()).notRanked.map((entry) => entry.activity)).toEqual([
      'ski',
      'surfing',
    ]);
  });

  it('accounts for every activity it was given exactly once', () => {
    const day = rankDay([
      result('ski', inapplicable),
      result('surfing', missing),
      result('indoor-sightseeing', score(50)),
      result('outdoor-sightseeing', zeroed),
    ]);

    expect([...day.ranked, ...day.notRanked].map((entry) => entry.activity).toSorted()).toEqual([
      'indoor-sightseeing',
      'outdoor-sightseeing',
      'ski',
      'surfing',
    ]);
  });
});
