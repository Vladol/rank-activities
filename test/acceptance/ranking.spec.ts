import { describe, expect, it } from 'vitest';

import { rankSettled, rankingHarness } from '../support/ranking';
import { FailingSeriesPort } from '../support/fake-series-port';
import { domainError } from '../../src/domain/shared/domain-error';
import type { ActivityOutcome } from '../../src/domain/ranking/activity-outcome';
import type { LocationQuery } from '../../src/modules/geo/location-resolver.service';
import {
  type RankedReferenceDay,
  orderOf,
  outcomeOf,
  rankReferenceCase,
  readSeries,
  referenceCase,
} from './support/reference-cases';

/**
 * The rows of docs/development-flow/stage-two.md, section 12 that concern the
 * ranking itself — one `it` per row, named after the row.
 *
 * The rows about whether an activity is possible at a place are the other half
 * of the same table and live in `applicability.spec.ts`; the two files together
 * cover it. Everything here runs the shipped declarations, the shipped profile
 * and the recorded responses.
 */
describe('stage two, section 12: the ranking cases', () => {
  it('Lisbon, the main surf case: surfing is ranked on its merits, with an explanation', async () => {
    const days = await rankReferenceCase('lisbon-surf');
    const surfing = outcomeOf(days[0]!, 'surfing');

    expect(surfing?.kind).toBe('ranked');
    expect(surfing?.kind === 'ranked' ? surfing.score : -1).toBeGreaterThan(0);
    expect(surfing?.kind === 'ranked' ? surfing.constraintViolated : 'set').toBeUndefined();
    expect(surfing?.kind === 'ranked' ? surfing.breakdown.length : 0).toBeGreaterThan(0);
  });

  it('Chamonix in summer, season is not applicability: ski is Ranked(0, NO_SNOW_COVER), not NotApplicable', async () => {
    const days = await rankReferenceCase('chamonix-summer');

    for (const day of days) {
      expect(outcomeOf(day, 'ski')).toMatchObject({
        kind: 'ranked',
        score: 0,
        constraintViolated: 'NO_SNOW_COVER',
      });
    }
  });

  it('Odessa in a flat calm: a flat sea is Ranked(0, FLAT_SEA), not NotApplicable', async () => {
    const days = await rankReferenceCase('marine-odessa-flat');
    const flat = days.filter((day) => {
      const surfing = outcomeOf(day, 'surfing');

      return surfing?.kind === 'ranked' && surfing.constraintViolated === 'FLAT_SEA';
    });

    expect(flat.length).toBeGreaterThan(0);

    for (const day of flat) {
      expect(outcomeOf(day, 'surfing')).toMatchObject({ kind: 'ranked', score: 0 });
    }
  });

  it('Tromso in December, the polar night: the outdoor activities are zeroed and indoor is not', async () => {
    const days = await rankReferenceCase('tromso-polar-night');

    for (const day of days) {
      for (const outdoor of ['ski', 'outdoor-sightseeing']) {
        expect(outcomeOf(day, outdoor)).toMatchObject({
          kind: 'ranked',
          score: 0,
          constraintViolated: 'NO_DAYLIGHT',
        });
      }

      const indoor = outcomeOf(day, 'indoor-sightseeing');

      expect(indoor?.kind).toBe('ranked');
      expect(indoor?.kind === 'ranked' ? indoor.score : 0).toBeGreaterThan(0);
      expect(indoor?.kind === 'ranked' ? indoor.constraintViolated : 'set').toBeUndefined();
      expect(orderOf(day)[0]).toBe('indoor-sightseeing');
    }
  });

  it('Tromso in December: no score anywhere in the answer is non-numeric', async () => {
    const days = await rankReferenceCase('tromso-polar-night');

    for (const day of days) {
      for (const entry of day.ranking.ranked) {
        expect(entry.outcome.kind === 'ranked' ? Number.isFinite(entry.outcome.score) : false).toBe(
          true,
        );
      }
    }
  });

  it('a storm with gusts past the threshold: all four activities are Ranked(0, SEVERE_WEATHER)', async () => {
    const days = await rankReferenceCase('storm-gusts');
    const stormy = days.filter((day) =>
      day.ranking.ranked.every(
        (entry) =>
          entry.outcome.kind === 'ranked' && entry.outcome.constraintViolated === 'SEVERE_WEATHER',
      ),
    );

    expect(stormy.length).toBeGreaterThan(0);

    for (const day of stormy) {
      // Indoor included: a cross-cutting constraint is cross-cutting.
      expect(outcomeOf(day, 'indoor-sightseeing')).toMatchObject({
        kind: 'ranked',
        score: 0,
        constraintViolated: 'SEVERE_WEATHER',
      });
      expect(day.ranking.ranked).toHaveLength(4);
    }
  });

  it('London, rain: the indoor activity is first on every day whose daylight hours are wet', async () => {
    // Stage two says "rain seven days". The recording is not that week — two of
    // its days hold no precipitation at all — and the discrepancy is already
    // written down in `limiting-features.spec.ts`. What this change owns is the
    // ordering, so it is asserted where the recording supports the premise, and
    // its converse is asserted on the dry days of the same week.
    const days = await rankReferenceCase('london-rainy');
    const wet = days.filter((day) => dryDaylightShare(day) < 0.4);
    const dry = days.filter((day) => dryDaylightShare(day) > 0.9);

    expect(wet.length, 'the recording must hold a genuinely wet day').toBeGreaterThan(0);
    expect(dry.length, 'and a dry one, or the claim is untested').toBeGreaterThan(0);

    for (const day of wet) {
      expect(orderOf(day)[0], day.date).toBe('indoor-sightseeing');
    }

    for (const day of dry) {
      expect(orderOf(day)[0], day.date).toBe('outdoor-sightseeing');
    }
  });

  it('Dubai at +45 C and clear: indoor outranks outdoor, driven by heat rather than by rain', async () => {
    const days = await rankReferenceCase('dubai-heat');

    for (const day of days) {
      const order = orderOf(day);

      expect(order.indexOf('indoor-sightseeing')).toBeLessThan(
        order.indexOf('outdoor-sightseeing'),
      );
    }
  });

  it('Auckland at UTC+13, the day offset: the local dates are the source own and do not shift', async () => {
    // Stage two names Auckland. Queenstown is the recorded point on the same
    // Pacific/Auckland axis, twelve hours from UTC: whichever way our clock
    // reads, the labels must be the ones the source wrote, because we do no
    // local-time arithmetic at all (TD-01 of stage-two.md, section 10).
    const series = await readSeries(referenceCase('queenstown-nz-ski'));
    const days = await rankReferenceCase('queenstown-nz-ski');
    const fromSource = [...new Set((series?.hourly.time ?? []).map((slot) => slot.slice(0, 10)))];

    expect(fromSource.length).toBeGreaterThan(1);
    expect(days.map((day) => day.date)).toEqual(fromSource);
  });

  it('Tromso in December: an explicit window keeps the dates the source recorded', async () => {
    // The other half of the same claim, on an axis nothing rebases: the dates
    // asked for are the dates answered, to the day.
    const days = await rankReferenceCase('tromso-polar-night');

    expect(days.map((day) => day.date)).toEqual([
      '2024-12-15',
      '2024-12-16',
      '2024-12-17',
      '2024-12-18',
      '2024-12-19',
      '2024-12-20',
      '2024-12-21',
    ]);
  });

  it('Queenstown in July, the southern hemisphere: ski is scored rather than refused', async () => {
    const days = await rankReferenceCase('queenstown-nz-ski');

    for (const day of days) {
      expect(outcomeOf(day, 'ski')?.kind).toBe('ranked');
    }
  });

  it.skip('a request at 18:00: the current day is computed from what is left of it (TD-01)', () => {
    // Deferred with TD-01 of stage-two.md, section 10: local-time arithmetic is
    // the provider's until `luxon` enters the stack. Every day the service
    // returns today is a whole one, and says so.
  });

  it.skip('a daylight-saving transition: the share of hours uses the day actual length (TD-01)', () => {
    // Deferred with TD-01. `DayWindow.hoursInDay` already counts the slots the
    // series holds rather than assuming 24, so the arithmetic is ready; what is
    // missing is a recording of a transition day.
  });
});

/** The share of daylight hours outdoor sightseeing counted as dry that day. */
function dryDaylightShare(day: RankedReferenceDay): number {
  const outdoor = outcomeOf(day, 'outdoor-sightseeing');

  if (outdoor?.kind !== 'ranked') {
    return 1;
  }

  return outdoor.breakdown.find((entry) => entry.featureId === 'dryHours')?.raw?.value ?? 1;
}

describe('the ordering the answer is delivered in', () => {
  it('orders the ranked results by descending score on every day of every case', async () => {
    for (const name of ['lisbon-surf', 'london-rainy', 'dubai-heat', 'queenstown-nz-ski']) {
      for (const day of await rankReferenceCase(name)) {
        const scores = day.ranking.ranked.map((entry) =>
          entry.outcome.kind === 'ranked' ? entry.outcome.score : Number.NaN,
        );

        expect(scores).toEqual(scores.toSorted((left, right) => right - left));
      }
    }
  });

  it('never puts a non-scored outcome among the ranked ones', async () => {
    for (const name of ['lisbon-surf', 'chamonix-summer', 'tromso-polar-night']) {
      for (const day of await rankReferenceCase(name)) {
        expect(day.ranking.ranked.every((entry) => entry.outcome.kind === 'ranked')).toBe(true);
        expect(day.ranking.notRanked.every((entry) => entry.outcome.kind !== 'ranked')).toBe(true);
      }
    }
  });

  it('answers the same way twice over unchanged recordings', async () => {
    const first = await rankReferenceCase('lisbon-surf');
    const second = await rankReferenceCase('lisbon-surf');

    expect(second.map(orderOf)).toEqual(first.map(orderOf));
  });
});


/**
 * The requirement the whole contract is built around: "surfing in Prague",
 * "surfing in Lisbon on a flat day", "surfing in Lisbon with good waves" and
 * "surfing in Lisbon while the wave model is down" are four different
 * statements, and one number cannot carry them.
 */
const LISBON: LocationQuery = {
  kind: 'coordinates',
  coordinates: { latitude: 38.7167, longitude: -9.1333 },
};
const PRAGUE: LocationQuery = {
  kind: 'coordinates',
  coordinates: { latitude: 50.0875, longitude: 14.4213 },
};

async function surfingAt(
  location: LocationQuery,
  marine?: FailingSeriesPort<'marine'>,
): Promise<ActivityOutcome | undefined> {
  const harness = rankingHarness(marine === undefined ? {} : { marine });
  const answer = await rankSettled(harness, { location, days: 1 });

  if (!answer.ok) {
    throw new Error(`The ranking was expected to answer: ${answer.error.code}`);
  }

  const day = answer.value.days[0];

  return (
    [...(day?.ranking.ranked ?? []), ...(day?.ranking.notRanked ?? [])].find(
      (entry) => entry.activity === 'surfing',
    )?.outcome ??
    answer.value.undated.find((entry) => entry.activity === 'surfing')?.outcome
  );
}

describe('the four distinguishable answers', () => {
  it('tells an impossible place from a flat day from a good day from an unavailable source', async () => {
    const inland = await surfingAt(PRAGUE);
    const good = await surfingAt(LISBON);
    const down = await surfingAt(
      LISBON,
      new FailingSeriesPort('marine', domainError('TRANSPORT_FAILURE', 'unreachable')),
    );
    const flat = outcomeOf((await rankReferenceCase('marine-odessa-flat')).find(
      (day) => {
        const surfing = outcomeOf(day, 'surfing');

        return surfing?.kind === 'ranked' && surfing.constraintViolated === 'FLAT_SEA';
      },
    )!, 'surfing');

    expect(inland).toEqual({ kind: 'not_applicable', reason: 'NO_COASTLINE_NEARBY' });
    expect(flat).toMatchObject({ kind: 'ranked', score: 0, constraintViolated: 'FLAT_SEA' });
    expect(good?.kind).toBe('ranked');
    expect(good?.kind === 'ranked' ? good.score : 0).toBeGreaterThan(0);
    expect(down).toMatchObject({ kind: 'no_data', retryable: true });

    // Four answers, four distinguishable shapes: nothing here can be mistaken
    // for anything else here by a client that reads only the fields it knows.
    expect(new Set([inland, flat, good, down].map(shapeOf)).size).toBe(4);
  });
});

/** How an outcome reads to a client that branches on kind, score and reason. */
function shapeOf(outcome: ActivityOutcome | undefined): string {
  if (outcome === undefined) {
    return 'absent';
  }

  if (outcome.kind !== 'ranked') {
    return `${outcome.kind}:${outcome.reason}`;
  }

  return `ranked:${outcome.score > 0 ? 'positive' : 'zero'}:${outcome.constraintViolated ?? 'none'}`;
}
