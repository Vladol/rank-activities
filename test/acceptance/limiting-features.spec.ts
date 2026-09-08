import { describe, expect, it } from 'vitest';

import {
  type DayOutcomes,
  referenceCase,
  scoreOf,
  scoreReferenceCase,
} from './support/reference-cases';

/**
 * The two reference cases that a weighted sum alone cannot satisfy at once
 * (docs/development-flow/stage-five.md, section 5.5).
 *
 * Dubai forces the thermal comfort weight above 0.59 for indoor to win;
 * London forces it below 0.35. The interval is empty, and no assignment of
 * weights closes it, because a weighted sum is compensatory by construction
 * and +45 C admits no compensation. Both pass here under one set of weights
 * because thermal comfort limits the score instead of contributing to it.
 *
 * If the limiting role were removed and its weight folded back into the sum,
 * one of these two tests would fail whatever weight was chosen. That is the
 * property being defended.
 */
/** The share of daylight hours outdoor sightseeing counted as dry that day. */
function dryDaylightShare(day: DayOutcomes): number {
  const outdoor = day.outcomes.get('outdoor-sightseeing');

  if (outdoor?.kind !== 'ranked') {
    return 1;
  }

  return outdoor.breakdown.find((entry) => entry.featureId === 'dryHours')?.raw?.value ?? 1;
}

function indoorBeatsOutdoor(day: DayOutcomes): boolean {
  const indoor = scoreOf(day, 'indoor-sightseeing');
  const outdoor = scoreOf(day, 'outdoor-sightseeing');

  return indoor !== undefined && outdoor !== undefined && indoor > outdoor;
}

describe('Dubai, +45 C and clear', () => {
  it('ranks indoor above outdoor on every day of the week', async () => {
    const days = await scoreReferenceCase(referenceCase('dubai-heat'));

    expect(days.length).toBeGreaterThan(0);

    for (const day of days) {
      expect(
        indoorBeatsOutdoor(day),
        `${day.date}: indoor ${scoreOf(day, 'indoor-sightseeing')}, outdoor ${scoreOf(day, 'outdoor-sightseeing')}`,
      ).toBe(true);
    }
  });

  it('keeps outdoor a low score rather than a refusal, because +45 C is not impossible', async () => {
    const days = await scoreReferenceCase(referenceCase('dubai-heat'));

    for (const day of days) {
      const outdoor = day.outcomes.get('outdoor-sightseeing');

      expect(outdoor?.kind).toBe('ranked');

      if (outdoor?.kind !== 'ranked') {
        continue;
      }

      // A refusal names a reason; a gradual penalty must not pretend to be one.
      expect(outdoor.constraintViolated).toBeUndefined();
      expect(outdoor.score).toBeGreaterThan(0);
    }
  });

  it('shows the limiting feature as the reason outdoor is low', async () => {
    const [day] = await scoreReferenceCase(referenceCase('dubai-heat'));
    const outdoor = day?.outcomes.get('outdoor-sightseeing');

    expect(outdoor?.kind).toBe('ranked');

    if (outdoor?.kind !== 'ranked') {
      return;
    }

    const gate = outdoor.breakdown.find((entry) => entry.role === 'gate');

    expect(gate?.featureId).toBe('thermalComfort');
    // At its floor: the heat is not compensated by the cloudless sky.
    expect(gate?.gateFactor).toBeLessThan(0.3);
  });
});

describe('London, a wet day at a comfortable temperature', () => {
  /**
   * The second half of the contradiction. London forces the thermal comfort
   * weight *below* 0.35 for indoor to win, where Dubai forces it above 0.59.
   *
   * The reference case of stage-two.md, section 12 says "rain seven days", and
   * the recording named `london-rainy` is not that week: two of its seven days
   * hold no precipitation at all, and on a third the rain fell overnight, so
   * only 7 of the 13 daylight hours were wet. Asserting "indoor first every
   * day" against it would be asserting that a dry 20 C day in London is a day
   * for a museum, which is the opposite of what the service should say. The
   * requirement is therefore checked where the recording actually supports it:
   * on the day whose *daylight* hours are wet.
   */
  const WET_ENOUGH_TO_STAY_IN = 0.4;

  it('ranks indoor above outdoor on the day whose daylight hours are wet', async () => {
    const days = await scoreReferenceCase(referenceCase('london-rainy'));
    const wet = days.filter((day) => dryDaylightShare(day) < WET_ENOUGH_TO_STAY_IN);

    expect(wet.length, 'the recording must hold at least one genuinely wet day').toBeGreaterThan(0);

    for (const day of wet) {
      expect(
        indoorBeatsOutdoor(day),
        `${day.date}: indoor ${scoreOf(day, 'indoor-sightseeing')}, outdoor ${scoreOf(day, 'outdoor-sightseeing')}`,
      ).toBe(true);
    }
  });

  it('ranks outdoor above indoor on the dry days of the same week', async () => {
    // The other half of the same claim: a model that puts a museum first on a
    // dry September day in London would pass the test above and be useless.
    const days = await scoreReferenceCase(referenceCase('london-rainy'));
    const dry = days.filter((day) => dryDaylightShare(day) > 0.9);

    expect(dry.length).toBeGreaterThan(0);

    for (const day of dry) {
      expect(indoorBeatsOutdoor(day), day.date).toBe(false);
    }
  });

  it('wins that day on the additive features rather than through the limit', async () => {
    // The two cases are won by different mechanisms, which is the point: in
    // Dubai the limit collapses outdoor, in London the rain simply outweighs
    // it. A single weighted sum cannot do both.
    const days = await scoreReferenceCase(referenceCase('london-rainy'));
    const wet = days.find((day) => dryDaylightShare(day) < WET_ENOUGH_TO_STAY_IN);
    const outdoor = wet?.outcomes.get('outdoor-sightseeing');

    if (outdoor?.kind !== 'ranked') {
      throw new Error('Outdoor sightseeing must be scored in London.');
    }

    expect(outdoor.breakdown.find((entry) => entry.role === 'gate')?.gateFactor).toBeGreaterThan(0.6);
  });
});
