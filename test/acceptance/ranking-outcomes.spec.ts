import { describe, expect, it } from 'vitest';

import { daylightFlags, hourlyTimes, testSeries } from '../support/series';
import type { ResolvedDefinition } from '../../src/domain/activity/activity-definition';
import type { ActivityOutcome } from '../../src/domain/ranking/activity-outcome';
import { scoreActivity } from '../../src/domain/scoring/scoring-engine';
import { buildDayWindows } from '../../src/domain/weather/day-window';
import type { MetricValues } from '../../src/domain/weather/weather-series';
import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';
import { readScoringProfile } from '../../src/modules/scoring/scoring-profile.service';

/**
 * The two rows of docs/development-flow/stage-two.md, section 12 that no
 * recording holds: a dangerous sea, and a day with more holes than it can be
 * judged from.
 *
 * Both are written as synthetic series rather than as fixtures, because a
 * fixture is a recorded response and neither of these was ever recorded — the
 * Atlantic recordings top out at 0.86 m, and every recorded day is complete.
 * The declarations, the constraints and the engine are the shipped ones; only
 * the weather is written here (flow.md, section 2.4, the level-two generator).
 */
const catalogue = SeedActivityCatalogue.load();
const profile = readScoringProfile();

function definition(code: string): ResolvedDefinition {
  const found = catalogue.find(code);

  if (found === undefined) {
    throw new Error(`The catalogue has no activity "${code}".`);
  }

  return found;
}

function constant(value: number | null, hours = 24): MetricValues {
  return Array.from({ length: hours }, () => value);
}

function scoreDays(activity: string, series: ReturnType<typeof testSeries>): ActivityOutcome[] {
  return buildDayWindows(series).map((window) =>
    scoreActivity(definition(activity), series, window, profile),
  );
}

describe('stage two, section 12: a storm on the coast', () => {
  const stormySea = (waveHeight: number) =>
    testSeries({
      hourlyTime: hourlyTimes('2026-09-08'),
      hourly: {
        wave_height: constant(waveHeight),
        wave_period: constant(11),
        wind_speed_10m: constant(9),
        sea_surface_temperature: constant(17),
        is_day: daylightFlags(24, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
      },
    });

  it('a dangerous wave is Ranked(0, DANGEROUS_SURF), a refusal with a reason rather than a low score', () => {
    expect(scoreDays('surfing', stormySea(4.5))[0]).toMatchObject({
      kind: 'ranked',
      score: 0,
      constraintViolated: 'DANGEROUS_SURF',
    });
  });

  it('the same sea one step below the threshold is scored on its merits', () => {
    const outcome = scoreDays('surfing', stormySea(3.5))[0];

    expect(outcome?.kind).toBe('ranked');
    expect(outcome?.kind === 'ranked' ? outcome.score : 0).toBeGreaterThan(0);
    expect(outcome?.kind === 'ranked' ? outcome.constraintViolated : 'set').toBeUndefined();
  });

  it('is not reported as inapplicable: the sea is there, today is not the day', () => {
    expect(scoreDays('surfing', stormySea(4.5))[0]?.kind).not.toBe('not_applicable');
  });
});

describe('stage two, section 12: a series with holes', () => {
  /** Half the day empty on the first date, complete on the second. */
  const halfEmptyThenWhole = (): ReturnType<typeof testSeries> => {
    const holed = Array.from({ length: 24 }, (_, hour) => (hour % 2 === 0 ? null : 0.8));

    return testSeries({
      hourlyTime: [...hourlyTimes('2026-09-08'), ...hourlyTimes('2026-09-09')],
      hourly: {
        snow_depth: [...holed, ...constant(0.8)],
        temperature_2m: constant(-4, 48),
        snowfall: constant(0, 48),
        wind_gusts_10m: constant(3, 48),
        is_day: [
          ...daylightFlags(24, [8, 9, 10, 11, 12, 13, 14, 15]),
          ...daylightFlags(24, [8, 9, 10, 11, 12, 13, 14, 15]),
        ],
      },
      daily: { daylight_duration: [28_800, 28_800] },
    });
  };

  it('a day above the gap threshold reports NoData(TOO_MANY_GAPS)', () => {
    expect(scoreDays('ski', halfEmptyThenWhole())[0]).toMatchObject({
      kind: 'no_data',
      reason: 'TOO_MANY_GAPS',
      missingMetrics: ['snow_depth'],
    });
  });

  it('says that retrying will not help: the holes will be the same tomorrow', () => {
    const outcome = scoreDays('ski', halfEmptyThenWhole())[0];

    expect(outcome?.kind === 'no_data' ? outcome.retryable : true).toBe(false);
  });

  it('leaves the other days of the same answer scored', () => {
    expect(scoreDays('ski', halfEmptyThenWhole())[1]?.kind).toBe('ranked');
  });
});
