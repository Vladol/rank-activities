import { metricRequirements } from '../../../src/domain/activity/metric-requirements';
import type { ResolvedDefinition } from '../../../src/domain/activity/activity-definition';
import type { ActivityOutcome } from '../../../src/domain/ranking/activity-outcome';
import { type DayRanking, rankDay } from '../../../src/domain/ranking/rank';
import { scoreActivity } from '../../../src/domain/scoring/scoring-engine';
import { buildDayWindows } from '../../../src/domain/weather/day-window';
import {
  derivedMetric,
  isDerivedMetric,
} from '../../../src/domain/weather/derived/derived-metric.registry';
import { type Capability, type MetricCode, metric } from '../../../src/domain/weather/metric';
import { mergeSeries } from '../../../src/domain/weather/merge-series';
import type { WeatherSeries } from '../../../src/domain/weather/weather-series';
import { SeedActivityCatalogue } from '../../../src/modules/activities/seed-catalogue';
import { readScoringProfile } from '../../../src/modules/scoring/scoring-profile.service';
import { recordedSeriesSource } from '../../../src/modules/weather/adapters/mock/recorded-sources';
import type { Horizon } from '../../../src/modules/weather/ports/contracts';

/**
 * The reference cases of docs/development-flow/stage-two.md, section 12, as
 * stage-five.md maps them onto fixtures in its section 14.2 — one entry per
 * row of that table.
 *
 * Everything here runs the real catalogue, the real profile and the real
 * recorded sources. A case that passed against a declaration written in the
 * test would say nothing about the declaration that ships.
 */
export interface ReferenceCase {
  readonly name: string;
  readonly location: { readonly latitude: number; readonly longitude: number };
  /** Which recorded capabilities to read, and over what horizon. */
  readonly reads: readonly { readonly capability: Capability; readonly horizon: Horizon }[];
  readonly note: string;
}

const week = (startDate: string, endDate: string): Horizon => ({
  kind: 'window',
  startDate,
  endDate,
});

const rolling: Horizon = { kind: 'forecast', forecastDays: 7 };

export const REFERENCE_CASES: readonly ReferenceCase[] = [
  {
    name: 'prague-inland',
    location: { latitude: 50.0875, longitude: 14.4213 },
    reads: [
      { capability: 'forecast', horizon: rolling },
      { capability: 'marine', horizon: rolling },
    ],
    note: 'Continental: the marine recording is empty over land',
  },
  {
    name: 'lisbon-surf',
    location: { latitude: 38.7167, longitude: -9.1333 },
    reads: [
      { capability: 'forecast', horizon: rolling },
      { capability: 'marine', horizon: rolling },
    ],
    note: 'An Atlantic swell with a real wind field',
  },
  {
    name: 'chamonix-winter-ski',
    location: { latitude: 45.9237, longitude: 6.8694 },
    reads: [{ capability: 'forecast', horizon: rolling }],
    note: 'Deep cover, cold, in the ski window',
  },
  {
    name: 'chamonix-summer',
    location: { latitude: 45.9237, longitude: 6.8694 },
    reads: [{ capability: 'archive', horizon: week('2025-07-08', '2025-07-14') }],
    note: 'Season is not applicability: ski is a scored zero, not unavailable',
  },
  {
    name: 'quito-highland',
    location: { latitude: -0.1807, longitude: -78.4678 },
    reads: [{ capability: 'archive', horizon: week('2025-07-08', '2025-07-14') }],
    note: '2850 m and no snow: elevation is not a snow season',
  },
  {
    name: 'tromso-polar-night',
    location: { latitude: 69.6489, longitude: 18.9551 },
    reads: [{ capability: 'archive', horizon: week('2024-12-15', '2024-12-21') }],
    note: 'No daylight at all: outdoor is zeroed, indoor is not',
  },
  {
    name: 'queenstown-nz-ski',
    location: { latitude: -45.0312, longitude: 168.6626 },
    reads: [{ capability: 'forecast', horizon: rolling }],
    note: 'A July ski season, decided by data rather than by month number',
  },
  {
    name: 'london-rainy',
    location: { latitude: 51.5085, longitude: -0.1257 },
    reads: [{ capability: 'forecast', horizon: rolling }],
    note: 'Drizzle all week at a comfortable temperature',
  },
  {
    name: 'dubai-heat',
    location: { latitude: 25.2048, longitude: 55.2708 },
    reads: [{ capability: 'archive', horizon: week('2025-07-29', '2025-08-04') }],
    note: 'Clear, dry, and far too hot to walk in',
  },
  {
    name: 'storm-gusts',
    location: { latitude: 53.3258, longitude: -9.8994 },
    reads: [{ capability: 'archive', horizon: week('2025-01-21', '2025-01-27') }],
    note: 'Gusts past the severe-weather threshold',
  },
  {
    name: 'marine-odessa-flat',
    location: { latitude: 46.4825, longitude: 30.7233 },
    reads: [{ capability: 'marine', horizon: week('2025-07-08', '2025-07-14') }],
    note: 'A flat sea: surfing is a scored zero with a reason',
  },
];

export interface DayOutcomes {
  readonly date: string;
  readonly outcomes: ReadonlyMap<string, ActivityOutcome>;
}

/** Every base metric the catalogue needs, with derived metrics expanded. */
export function requiredSourceMetrics(
  activities: readonly ResolvedDefinition[],
): readonly MetricCode[] {
  const codes = new Set<MetricCode>();

  for (const activity of activities) {
    for (const requirement of metricRequirements(activity)) {
      if (isDerivedMetric(requirement)) {
        for (const base of derivedMetric(requirement).requires) {
          codes.add(base);
        }
      } else {
        codes.add(requirement as MetricCode);
      }
    }
  }

  return [...codes];
}

export async function readSeries(reference: ReferenceCase): Promise<WeatherSeries | undefined> {
  const catalogue = SeedActivityCatalogue.load();
  const needed = requiredSourceMetrics(catalogue.activities());
  let series: WeatherSeries | undefined;

  for (const read of reference.reads) {
    // A forecast recording answers for the forecast metrics and an archive one
    // for the same metrics over a past window; marine answers for the waves.
    const metrics = needed.filter((code) =>
      read.capability === 'marine'
        ? metric(code).capability === 'marine'
        : metric(code).capability === 'forecast',
    );

    const result = await recordedSeriesSource(read.capability).fetch({
      capability: read.capability,
      location: reference.location,
      metrics,
      horizon: read.horizon,
      timezone: 'auto',
    });

    if (!result.ok) {
      // An absent recording is data about the place, not a broken test: the
      // marine call over Prague is exactly this.
      continue;
    }

    if (series === undefined) {
      series = result.value;
      continue;
    }

    const merged = mergeSeries(series, result.value);

    series = merged.ok ? merged.value : series;
  }

  return series;
}

export async function scoreReferenceCase(reference: ReferenceCase): Promise<readonly DayOutcomes[]> {
  const catalogue = SeedActivityCatalogue.load();
  const profile = readScoringProfile();
  const series = await readSeries(reference);

  if (series === undefined) {
    throw new Error(`No recording answered for the reference case "${reference.name}".`);
  }

  return buildDayWindows(series).map((window) => ({
    date: window.date,
    outcomes: new Map(
      catalogue
        .activities()
        .map((activity) => [activity.code, scoreActivity(activity, series, window, profile)]),
    ),
  }));
}

export function scoreOf(day: DayOutcomes, activity: string): number | undefined {
  const outcome = day.outcomes.get(activity);

  return outcome?.kind === 'ranked' ? outcome.score : undefined;
}

/**
 * One reference case, scored and then ordered — what a day of the answer holds
 * once `05-add-activity-ranking` has put the outcomes in order.
 *
 * Applicability is deliberately not folded in here. Whether surfing is
 * possible at a place is settled by `test/acceptance/applicability.spec.ts`
 * against the same recordings; what is under test here is the other half, the
 * one this change owns: given that it is possible, what does the day say.
 */
export async function rankReferenceCase(name: string): Promise<readonly RankedReferenceDay[]> {
  const days = await scoreReferenceCase(referenceCase(name));

  return days.map((day) => ({
    date: day.date,
    ranking: rankDay(
      [...day.outcomes].map(([activity, outcome]) => ({ activity, outcome })),
    ),
  }));
}

export interface RankedReferenceDay {
  readonly date: string;
  readonly ranking: DayRanking;
}

/** The activities of a day in the order they were ranked. */
export function orderOf(day: RankedReferenceDay): readonly string[] {
  return day.ranking.ranked.map((entry) => entry.activity);
}

export function outcomeOf(day: RankedReferenceDay, activity: string): ActivityOutcome | undefined {
  return [...day.ranking.ranked, ...day.ranking.notRanked].find(
    (entry) => entry.activity === activity,
  )?.outcome;
}

export function referenceCase(name: string): ReferenceCase {
  const found = REFERENCE_CASES.find((entry) => entry.name === name);

  if (found === undefined) {
    throw new Error(`No reference case is named "${name}".`);
  }

  return found;
}
