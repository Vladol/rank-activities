import { describe, expect, it } from 'vitest';

import { hourlyTimes, testSeries } from '../../../test/support/series';
import { loadDeclarations } from '../activity/declaration.load';
import type { ResolvedDefinition } from '../activity/activity-definition';
import { clamp01 } from '../shared/branded';
import { isOk } from '../shared/result';
import { buildDayWindows } from '../weather/day-window';
import type { WeatherSeries } from '../weather/weather-series';
import { DEFAULT_PROFILE, type ScoringProfile } from './scoring-profile';
import { extractValues, scoreActivity } from './scoring-engine';

/**
 * The six stages of docs/development-flow/stage-five.md, section 9. The order
 * of stages 2 to 4 is a decision, not a call sequence: coverage before
 * constraints, because a day that is 80 per cent empty grants no statement at
 * all; constraints before the null policy, because a fired constraint is
 * knowledge and an absent metric is the lack of it, and knowledge wins.
 */
const SHARED_RULES = {
  version: 1,
  rules: {
    'no-daylight': {
      reason: 'NO_DAYLIGHT',
      when: {
        metric: 'daylight_duration',
        unit: 'second',
        aggregation: { type: 'identity' },
        op: 'lte',
        value: 0,
      },
    },
  },
};

function define(declaration: Record<string, unknown>): ResolvedDefinition {
  const result = loadDeclarations([declaration], SHARED_RULES);

  if (!isOk(result) || result.value[0] === undefined) {
    throw new Error(
      `The fixture declaration must load: ${JSON.stringify(isOk(result) ? [] : result.error)}`,
    );
  }

  return result.value[0];
}

/** Two contributing features over metrics with no shared behaviour. */
function twoFeatureActivity(overrides: Record<string, unknown> = {}): ResolvedDefinition {
  return define({
    code: 'test-activity',
    version: 1,
    titleKey: 'activity.test',
    features: [
      {
        id: 'warmth',
        metric: 'temperature_2m',
        unit: 'degC',
        aggregation: { type: 'mean' },
        normalizer: { type: 'linear', params: { from: 0, to: 20 } },
        weight: 0.75,
        nullPolicy: 'degrade',
      },
      {
        id: 'calm',
        metric: 'wind_speed_10m',
        unit: 'm/s',
        aggregation: { type: 'max' },
        normalizer: { type: 'inverse', params: { from: 0, to: 20 } },
        weight: 0.25,
        nullPolicy: 'degrade',
      },
    ],
    ...overrides,
  });
}

function oneDay(hourly: Record<string, readonly (number | null)[]>, daily?: Record<string, readonly (number | null)[]>) {
  const hours = Object.values(hourly)[0]?.length ?? 24;
  const series: WeatherSeries = testSeries({
    hourlyTime: hourlyTimes('2026-01-14', hours),
    hourly: hourly as never,
    ...(daily === undefined ? {} : { daily: daily as never }),
  });
  const window = buildDayWindows(series)[0];

  if (window === undefined) {
    throw new Error('The fixture must hold one day.');
  }

  return { series, window };
}

const CALM_WARM = { temperature_2m: [10, 10, 10, 10], wind_speed_10m: [0, 0, 0, 0] };

describe('stage 1: what the declaration refers to is aggregated', () => {
  it('aggregates every feature into a value with its sample and missing counts', () => {
    const { series, window } = oneDay({
      temperature_2m: [8, 12, null, 10],
      wind_speed_10m: [1, 5, 3, 2],
    });

    const values = extractValues(twoFeatureActivity(), series, window);

    expect(values.of('temperature_2m', { type: 'mean' })).toMatchObject({
      value: 10,
      unit: 'degC',
      sampleCount: 3,
      missingCount: 1,
    });
    expect(values.of('wind_speed_10m', { type: 'max' })?.value).toBe(5);
  });

  it('aggregates what only a constraint refers to, not just the features', () => {
    // weather_code is nobody's feature, and without it SEVERE_WEATHER cannot
    // be decided (stage-five.md, section 9, stage 1).
    const activity = twoFeatureActivity({
      constraints: [
        {
          reason: 'SEVERE_WEATHER',
          when: {
            metric: 'weather_code',
            unit: 'wmo_code',
            aggregation: {
              type: 'countIf',
              params: { predicate: { op: 'in', value: [95, 96] }, window: 'day' },
            },
            op: 'gte',
            value: 1,
          },
        },
      ],
    });
    const { series, window } = oneDay({
      ...CALM_WARM,
      weather_code: [3, 95, 3, 96],
    });

    const values = extractValues(activity, series, window);

    expect(
      values.of('weather_code', {
        type: 'countIf',
        params: { predicate: { op: 'in', value: [95, 96] }, window: 'day' },
      })?.value,
    ).toBe(2);
  });

  it('has no value for a metric the series does not carry at all', () => {
    const { series, window } = oneDay({ temperature_2m: [10, 10, 10, 10] });

    expect(extractValues(twoFeatureActivity(), series, window).of('wind_speed_10m', { type: 'max' })).toBeNull();
  });
});

describe('stage 5: normalisation, weighting and combination', () => {
  it('combines the contributing features as a weighted sum', () => {
    const { series, window } = oneDay({
      temperature_2m: [10, 10, 10, 10],
      wind_speed_10m: [10, 10, 10, 10],
    });

    // warmth 0.5 at weight 0.75, calm 0.5 at weight 0.25 -> 0.5 -> 50.
    const outcome = scoreActivity(twoFeatureActivity(), series, window, DEFAULT_PROFILE);

    expect(outcome).toMatchObject({ kind: 'ranked', score: 50 });
  });

  it('emits a breakdown whose contributions reproduce the score', () => {
    const { series, window } = oneDay({
      temperature_2m: [16, 16, 16, 16],
      wind_speed_10m: [4, 4, 4, 4],
    });
    const outcome = scoreActivity(twoFeatureActivity(), series, window, DEFAULT_PROFILE);

    expect(outcome.kind).toBe('ranked');

    if (outcome.kind !== 'ranked') {
      return;
    }

    const sum = outcome.breakdown
      .filter((entry) => entry.role === 'additive' && entry.status !== 'excluded')
      .reduce((total, entry) => total + (entry.contribution ?? 0), 0);
    const gates = outcome.breakdown
      .filter((entry) => entry.role === 'gate')
      .reduce((product, entry) => product * (entry.gateFactor ?? 1), 1);

    expect(sum * gates * 100).toBeCloseTo(outcome.score, 8);
  });

  it('shows each feature raw value beside its normalised one', () => {
    const { series, window } = oneDay(CALM_WARM);
    const outcome = scoreActivity(twoFeatureActivity(), series, window, DEFAULT_PROFILE);

    expect(outcome.kind).toBe('ranked');

    if (outcome.kind !== 'ranked') {
      return;
    }

    expect(outcome.breakdown.find((entry) => entry.featureId === 'warmth')).toMatchObject({
      metric: 'temperature_2m',
      status: 'used',
      normalized: 0.5,
      raw: { value: 10, unit: 'degC', sampleCount: 4, missingCount: 0 },
    });
  });
});

describe('stage 5: a limiting feature multiplies the sum it does not join', () => {
  function gated(): ResolvedDefinition {
    return twoFeatureActivity({
      features: [
        ...(twoFeatureActivity().features.map((feature) => ({
          id: feature.id,
          metric: feature.metric,
          unit: feature.unit,
          aggregation: feature.aggregation,
          normalizer: feature.normalizer,
          weight: feature.id === 'warmth' ? 0.75 : 0.25,
          nullPolicy: feature.nullPolicy,
        })) as unknown[]),
        {
          id: 'thermalComfort',
          role: 'gate',
          gateFloor: 0.15,
          metric: 'apparent_temperature',
          unit: 'degC',
          aggregation: { type: 'mean' },
          normalizer: { type: 'trapezoid', params: { a: 2, b: 15, c: 25, d: 33 } },
          nullPolicy: 'degrade',
        },
      ],
    });
  }

  it('changes nothing when the limiting feature is at its best', () => {
    const { series, window } = oneDay({ ...CALM_WARM, apparent_temperature: [20, 20, 20, 20] });
    const outcome = scoreActivity(gated(), series, window, DEFAULT_PROFILE);

    // warmth 0.5 * 0.75 + calm 1.0 * 0.25 = 0.625, gate 1.0 -> 62.5 -> 63.
    expect(outcome).toMatchObject({ kind: 'ranked', score: 63 });
  });

  it('pulls an otherwise perfect day down to the limit it declares', () => {
    const { series, window } = oneDay({
      temperature_2m: [20, 20, 20, 20],
      wind_speed_10m: [0, 0, 0, 0],
      apparent_temperature: [45, 45, 45, 45],
    });
    const outcome = scoreActivity(gated(), series, window, DEFAULT_PROFILE);

    // Every contributing feature is perfect; the gate is at its worst.
    expect(outcome).toMatchObject({ kind: 'ranked', score: 15 });

    if (outcome.kind !== 'ranked') {
      return;
    }

    // Still a score, not a refusal, and it carries no reason code.
    expect(outcome.constraintViolated).toBeUndefined();
    expect(outcome.breakdown.find((entry) => entry.featureId === 'thermalComfort')).toMatchObject({
      role: 'gate',
      weight: null,
      contribution: null,
      gateFactor: 0.15,
    });
  });

  it('does not punish through a limiting feature that has no data', () => {
    const { series, window } = oneDay(CALM_WARM);
    const outcome = scoreActivity(gated(), series, window, DEFAULT_PROFILE);

    expect(outcome).toMatchObject({ kind: 'ranked', score: 63 });

    if (outcome.kind !== 'ranked') {
      return;
    }

    expect(outcome.breakdown.find((entry) => entry.featureId === 'thermalComfort')).toMatchObject({
      status: 'degraded',
      gateFactor: 1,
      raw: null,
    });
  });
});

describe('stage 4: the declared null policy decides what a missing value means', () => {
  const policies = (policy: string) =>
    twoFeatureActivity({
      features: [
        {
          id: 'warmth',
          metric: 'temperature_2m',
          unit: 'degC',
          aggregation: { type: 'mean' },
          normalizer: { type: 'linear', params: { from: 0, to: 20 } },
          weight: 0.75,
          nullPolicy: 'degrade',
        },
        {
          id: 'calm',
          metric: 'wind_speed_10m',
          unit: 'm/s',
          aggregation: { type: 'max' },
          normalizer: { type: 'inverse', params: { from: 0, to: 20 } },
          weight: 0.25,
          nullPolicy: policy,
        },
      ],
    });

  it('degrades to the profile neutral value, keeping the weight', () => {
    const { series, window } = oneDay({ temperature_2m: [10, 10, 10, 10] });
    const outcome = scoreActivity(policies('degrade'), series, window, DEFAULT_PROFILE);

    // warmth 0.5 * 0.75 + neutral 0.5 * 0.25 = 0.5.
    expect(outcome).toMatchObject({ kind: 'ranked', score: 50 });

    if (outcome.kind !== 'ranked') {
      return;
    }

    expect(outcome.breakdown.find((entry) => entry.featureId === 'calm')).toMatchObject({
      status: 'degraded',
      normalized: 0.5,
      raw: null,
    });
  });

  it('excludes and redistributes the weight, keeping the scale', () => {
    const { series, window } = oneDay({ temperature_2m: [10, 10, 10, 10] });
    const outcome = scoreActivity(policies('exclude'), series, window, DEFAULT_PROFILE);

    // warmth alone, reweighted to 1.0: 0.5 -> 50, the same scale as a full day.
    expect(outcome).toMatchObject({ kind: 'ranked', score: 50 });

    if (outcome.kind !== 'ranked') {
      return;
    }

    const excluded = outcome.breakdown.find((entry) => entry.featureId === 'calm');

    // Visible as excluded rather than silently gone.
    expect(excluded).toMatchObject({ status: 'excluded', weight: null, contribution: null });
    expect(outcome.breakdown.find((entry) => entry.featureId === 'warmth')?.weight).toBeCloseTo(1, 12);
  });

  it('fails the day for the activity, naming the metric', () => {
    const { series, window } = oneDay({ temperature_2m: [10, 10, 10, 10] });
    const outcome = scoreActivity(policies('fail'), series, window, DEFAULT_PROFILE);

    expect(outcome).toMatchObject({
      kind: 'no_data',
      reason: 'MISSING_REQUIRED_METRIC',
      missingMetrics: ['wind_speed_10m'],
    });
  });

  it('never reports a required missing feature as a score of zero', () => {
    const { series, window } = oneDay({ temperature_2m: [10, 10, 10, 10] });
    const outcome = scoreActivity(policies('fail'), series, window, DEFAULT_PROFILE);

    expect(outcome.kind).not.toBe('ranked');
  });

  it('reports no data when every contributing feature was excluded', () => {
    const activity = twoFeatureActivity({
      features: [
        {
          id: 'warmth',
          metric: 'temperature_2m',
          unit: 'degC',
          aggregation: { type: 'mean' },
          normalizer: { type: 'linear', params: { from: 0, to: 20 } },
          weight: 0.5,
          nullPolicy: 'exclude',
        },
        {
          id: 'calm',
          metric: 'wind_speed_10m',
          unit: 'm/s',
          aggregation: { type: 'max' },
          normalizer: { type: 'inverse', params: { from: 0, to: 20 } },
          weight: 0.5,
          nullPolicy: 'exclude',
        },
      ],
    });
    const { series, window } = oneDay({ cloud_cover: [10, 10, 10, 10] });

    expect(scoreActivity(activity, series, window, DEFAULT_PROFILE).kind).toBe('no_data');
  });

  it('scores an activity whose remaining features are satisfied when a metric is null throughout', () => {
    // The ERA5 case: visibility is null in all 168 slots, and ski must still
    // be scored by reweighting rather than fall into NoData.
    const { series, window } = oneDay({
      temperature_2m: [10, 10, 10, 10],
      wind_speed_10m: [null, null, null, null],
    });

    expect(scoreActivity(policies('exclude'), series, window, DEFAULT_PROFILE).kind).toBe('ranked');
  });
});

describe('stage 2: a day with too many gaps is not scored', () => {
  const required = twoFeatureActivity({
    features: [
      {
        id: 'warmth',
        metric: 'temperature_2m',
        unit: 'degC',
        aggregation: { type: 'mean' },
        normalizer: { type: 'linear', params: { from: 0, to: 20 } },
        weight: 1,
        nullPolicy: 'fail',
      },
    ],
  });

  it('reports missing data when a required metric is partly there and too full of holes', () => {
    const { series, window } = oneDay({
      temperature_2m: [10, null, null, null, null, null, null, 10],
    });

    expect(scoreActivity(required, series, window, DEFAULT_PROFILE)).toMatchObject({
      kind: 'no_data',
      reason: 'TOO_MANY_GAPS',
    });
  });

  it('scores a day whose gaps stay under the threshold', () => {
    const { series, window } = oneDay({ temperature_2m: [10, 10, 10, null] });

    expect(scoreActivity(required, series, window, DEFAULT_PROFILE).kind).toBe('ranked');
  });

  it('leaves a wholly absent metric to the null policy instead of calling it a gap', () => {
    const { series, window } = oneDay({
      temperature_2m: [null, null, null, null],
    });
    const outcome = scoreActivity(required, series, window, DEFAULT_PROFILE);

    // No value at all is not incompleteness; the "fail" policy decides.
    expect(outcome).toMatchObject({ kind: 'no_data', reason: 'MISSING_REQUIRED_METRIC' });
  });

  it('decides each day on its own completeness', () => {
    const series = testSeries({
      hourlyTime: [...hourlyTimes('2026-01-14', 4), ...hourlyTimes('2026-01-15', 4)],
      hourly: { temperature_2m: [10, null, null, null, 10, 10, 10, 10] },
    });
    const [holed, whole] = buildDayWindows(series);

    expect(scoreActivity(required, series, holed ?? buildDayWindows(series)[0]!, DEFAULT_PROFILE).kind).toBe(
      'no_data',
    );
    expect(scoreActivity(required, series, whole ?? buildDayWindows(series)[0]!, DEFAULT_PROFILE).kind).toBe(
      'ranked',
    );
  });

  it('does not judge a feature the activity can do without by the gap rule', () => {
    const optional = twoFeatureActivity({
      features: [
        {
          id: 'warmth',
          metric: 'temperature_2m',
          unit: 'degC',
          aggregation: { type: 'mean' },
          normalizer: { type: 'linear', params: { from: 0, to: 20 } },
          weight: 1,
          nullPolicy: 'exclude',
        },
      ],
    });
    const { series, window } = oneDay({
      temperature_2m: [10, null, null, null, null, null, null, 10],
    });

    expect(scoreActivity(optional, series, window, DEFAULT_PROFILE).kind).toBe('ranked');
  });
});

describe('stage 3: hard constraints decide before weighting', () => {
  const constrained = (constraints: unknown[], include: string[] = []) =>
    twoFeatureActivity({ constraints, include });

  const snowCover = {
    reason: 'NO_SNOW_COVER',
    when: { metric: 'snow_depth', unit: 'm', aggregation: { type: 'max' }, op: 'lt', value: 0.1 },
  };
  const flatSea = {
    reason: 'FLAT_SEA',
    when: { metric: 'wave_height', unit: 'm', aggregation: { type: 'max' }, op: 'lt', value: 0.4 },
  };

  it('zeroes the day with the constraint reason, still as a score', () => {
    const { series, window } = oneDay({ ...CALM_WARM, snow_depth: [0.02, 0.02, 0.02, 0.02] });
    const outcome = scoreActivity(constrained([snowCover]), series, window, DEFAULT_PROFILE);

    expect(outcome).toMatchObject({
      kind: 'ranked',
      score: 0,
      constraintViolated: 'NO_SNOW_COVER',
    });
  });

  it('reports the first declared constraint when two fire', () => {
    const { series, window } = oneDay({
      ...CALM_WARM,
      snow_depth: [0.02, 0.02, 0.02, 0.02],
      wave_height: [0.1, 0.1, 0.1, 0.1],
    });

    expect(
      scoreActivity(constrained([snowCover, flatSea]), series, window, DEFAULT_PROFILE),
    ).toMatchObject({ constraintViolated: 'NO_SNOW_COVER' });
    expect(
      scoreActivity(constrained([flatSea, snowCover]), series, window, DEFAULT_PROFILE),
    ).toMatchObject({ constraintViolated: 'FLAT_SEA' });
  });

  it('puts an included rule ahead of the activity own', () => {
    const { series, window } = oneDay(
      { ...CALM_WARM, snow_depth: [0.02, 0.02, 0.02, 0.02] },
      { daylight_duration: [0] },
    );

    expect(
      scoreActivity(constrained([snowCover], ['shared:no-daylight']), series, window, DEFAULT_PROFILE),
    ).toMatchObject({ constraintViolated: 'NO_DAYLIGHT' });
  });

  it('does not fire on a value that is absent', () => {
    // max(snow_depth) with no data does not mean there is no snow.
    const { series, window } = oneDay(CALM_WARM);

    expect(scoreActivity(constrained([snowCover]), series, window, DEFAULT_PROFILE).kind).toBe(
      'ranked',
    );
    expect(
      scoreActivity(constrained([snowCover]), series, window, DEFAULT_PROFILE),
    ).not.toMatchObject({ constraintViolated: 'NO_SNOW_COVER' });
  });

  it('outranks a required feature that has no value', () => {
    // What is known decides before what is absent (stage-five.md, section 9).
    const activity = twoFeatureActivity({
      constraints: [snowCover],
      features: [
        {
          id: 'warmth',
          metric: 'temperature_2m',
          unit: 'degC',
          aggregation: { type: 'mean' },
          normalizer: { type: 'linear', params: { from: 0, to: 20 } },
          weight: 1,
          nullPolicy: 'fail',
        },
      ],
    });
    const { series, window } = oneDay({ snow_depth: [0.02, 0.02, 0.02, 0.02] });

    expect(scoreActivity(activity, series, window, DEFAULT_PROFILE)).toMatchObject({
      kind: 'ranked',
      score: 0,
      constraintViolated: 'NO_SNOW_COVER',
    });
  });

  it('yields to coverage: a day too empty to judge grants no refusal either', () => {
    const activity = twoFeatureActivity({
      constraints: [snowCover],
      features: [
        {
          id: 'warmth',
          metric: 'temperature_2m',
          unit: 'degC',
          aggregation: { type: 'mean' },
          normalizer: { type: 'linear', params: { from: 0, to: 20 } },
          weight: 1,
          nullPolicy: 'fail',
        },
      ],
    });
    const { series, window } = oneDay({
      temperature_2m: [10, null, null, null, null, null, null, 10],
      snow_depth: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02],
    });

    expect(scoreActivity(activity, series, window, DEFAULT_PROFILE)).toMatchObject({
      kind: 'no_data',
      reason: 'TOO_MANY_GAPS',
    });
  });

  it('evaluates a composite rule without firing on an unknown branch', () => {
    const either = {
      reason: 'SEVERE_WEATHER',
      when: {
        anyOf: [
          {
            metric: 'weather_code',
            unit: 'wmo_code',
            aggregation: {
              type: 'countIf',
              params: { predicate: { op: 'in', value: [95, 96] }, window: 'day' },
            },
            op: 'gte',
            value: 1,
          },
          {
            metric: 'wind_gusts_10m',
            unit: 'm/s',
            aggregation: { type: 'max' },
            op: 'gte',
            value: 25,
          },
        ],
      },
    };

    const withGusts = oneDay({ ...CALM_WARM, wind_gusts_10m: [30, 30, 30, 30] });
    const withNeither = oneDay({ ...CALM_WARM, wind_gusts_10m: [3, 3, 3, 3] });

    expect(
      scoreActivity(constrained([either]), withGusts.series, withGusts.window, DEFAULT_PROFILE),
    ).toMatchObject({ constraintViolated: 'SEVERE_WEATHER' });
    // The weather-code branch has no data at all and must not decide anything.
    expect(
      scoreActivity(constrained([either]), withNeither.series, withNeither.window, DEFAULT_PROFILE),
    ).not.toMatchObject({ constraintViolated: 'SEVERE_WEATHER' });
  });
});

describe('stage 6: declared bounds are applied after combination', () => {
  const bounded = twoFeatureActivity({ postprocess: { floor: 40, ceiling: 85 } });

  it('does not fall below the floor on a poor day', () => {
    const { series, window } = oneDay({
      temperature_2m: [-10, -10, -10, -10],
      wind_speed_10m: [30, 30, 30, 30],
    });

    expect(scoreActivity(bounded, series, window, DEFAULT_PROFILE)).toMatchObject({ score: 40 });
  });

  it('does not rise above the ceiling on an ideal day', () => {
    const { series, window } = oneDay({
      temperature_2m: [20, 20, 20, 20],
      wind_speed_10m: [0, 0, 0, 0],
    });

    expect(scoreActivity(bounded, series, window, DEFAULT_PROFILE)).toMatchObject({ score: 85 });
  });

  it('lets a constraint beat the floor', () => {
    const withConstraint = twoFeatureActivity({
      postprocess: { floor: 40, ceiling: 85 },
      constraints: [
        {
          reason: 'SEVERE_WEATHER',
          when: {
            metric: 'wind_gusts_10m',
            unit: 'm/s',
            aggregation: { type: 'max' },
            op: 'gte',
            value: 25,
          },
        },
      ],
    });
    const { series, window } = oneDay({ ...CALM_WARM, wind_gusts_10m: [30, 30, 30, 30] });

    expect(scoreActivity(withConstraint, series, window, DEFAULT_PROFILE)).toMatchObject({
      score: 0,
      constraintViolated: 'SEVERE_WEATHER',
    });
  });
});

describe('the profile in force', () => {
  const impatient: ScoringProfile = {
    id: 'pessimist',
    version: 3,
    gapThreshold: clamp01(0.3),
    neutralScore: clamp01(0.2),
  };

  it('is named with every result', () => {
    const { series, window } = oneDay(CALM_WARM);
    const outcome = scoreActivity(twoFeatureActivity(), series, window, DEFAULT_PROFILE);

    expect(outcome).toMatchObject({
      profileId: DEFAULT_PROFILE.id,
      profileVersion: DEFAULT_PROFILE.version,
      definitionVersion: 1,
    });
  });

  it('gives one declaration two results under two profiles, each naming its own', () => {
    const { series, window } = oneDay({ temperature_2m: [10, 10, 10, 10] });
    const activity = twoFeatureActivity();

    const generous = scoreActivity(activity, series, window, DEFAULT_PROFILE);
    const strict = scoreActivity(activity, series, window, impatient);

    expect(generous).toMatchObject({ score: 50, profileVersion: DEFAULT_PROFILE.version });
    // The missing wind degrades to 0.2 rather than 0.5 under this profile.
    expect(strict).toMatchObject({ score: 43, profileVersion: 3, profileId: 'pessimist' });
  });
});

describe('determinism', () => {
  it('gives the same score, reasons and explanation order twice over', () => {
    const { series, window } = oneDay({
      temperature_2m: [8, 12, null, 10],
      wind_speed_10m: [1, 5, 3, 2],
    });
    const activity = twoFeatureActivity();

    const first = scoreActivity(activity, series, window, DEFAULT_PROFILE);
    const second = scoreActivity(activity, series, window, DEFAULT_PROFILE);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('keeps the explanation in the order the declaration lists its features', () => {
    const { series, window } = oneDay(CALM_WARM);
    const outcome = scoreActivity(twoFeatureActivity(), series, window, DEFAULT_PROFILE);

    expect(outcome.kind).toBe('ranked');

    if (outcome.kind !== 'ranked') {
      return;
    }

    expect(outcome.breakdown.map((entry) => entry.featureId)).toEqual(['warmth', 'calm']);
  });
});

describe('the engine has no per-activity branch', () => {
  it('evaluates two declarations that differ only in parameters by the same path', () => {
    const { series, window } = oneDay(CALM_WARM);
    const asSki = twoFeatureActivity({ code: 'ski', titleKey: 'activity.ski' });
    const asSurfing = twoFeatureActivity({ code: 'surfing', titleKey: 'activity.surfing' });

    const skiOutcome = scoreActivity(asSki, series, window, DEFAULT_PROFILE);
    const surfOutcome = scoreActivity(asSurfing, series, window, DEFAULT_PROFILE);

    expect(skiOutcome).toEqual(surfOutcome);
  });
});
