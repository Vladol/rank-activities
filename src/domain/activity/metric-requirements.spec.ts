import { describe, expect, it } from 'vitest';

import { isOk } from '../shared/result';
import { loadDeclarations } from './declaration.load';
import { metricRequirements } from './metric-requirements';

const SHARED_RULES = {
  version: 1,
  rules: {
    'severe-weather': {
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
    },
  },
};

function define(declaration: Record<string, unknown>) {
  const result = loadDeclarations([declaration], SHARED_RULES);

  if (!isOk(result) || result.value[0] === undefined) {
    throw new Error('The fixture declaration must load.');
  }

  return result.value[0];
}

const surfLike = define({
  code: 'surf-like',
  version: 1,
  titleKey: 'activity.surfLike',
  include: ['shared:severe-weather'],
  constraints: [
    {
      reason: 'FLAT_SEA',
      when: {
        metric: 'wave_height',
        unit: 'm',
        aggregation: { type: 'max' },
        op: 'lt',
        value: 0.4,
      },
    },
  ],
  features: [
    {
      id: 'windAlignment',
      metric: 'WIND_WAVE_ALIGNMENT',
      unit: 'degree',
      aggregation: { type: 'mean' },
      normalizer: { type: 'linear', params: { from: 60, to: 150 } },
      weight: 1,
      nullPolicy: 'degrade',
    },
  ],
});

describe('what a declaration requires', () => {
  it('walks the features', () => {
    expect(metricRequirements(surfLike)).toContain('WIND_WAVE_ALIGNMENT');
  });

  it('walks the constraints too, not only the features', () => {
    // wave_height is nobody's feature here, and FLAT_SEA cannot be decided
    // without it.
    expect(metricRequirements(surfLike)).toContain('wave_height');
  });

  it('walks into a composite rule branch by branch', () => {
    expect(metricRequirements(surfLike)).toContain('weather_code');
    expect(metricRequirements(surfLike)).toContain('wind_gusts_10m');
  });

  it('names each requirement once, in a stable order', () => {
    const first = metricRequirements(surfLike);

    expect([...new Set(first)]).toEqual([...first]);
    expect(metricRequirements(surfLike)).toEqual(first);
  });

  it('leaves a derived metric as itself, for the planner to expand', () => {
    // Expanding it here would put the planner's job in the declaration.
    expect(metricRequirements(surfLike)).not.toContain('wave_direction');
  });

  it('requires the daylight flag whenever a daylight window is aggregated', () => {
    const daylit = define({
      code: 'daylit',
      version: 1,
      titleKey: 'activity.daylit',
      features: [
        {
          id: 'warmth',
          metric: 'temperature_2m',
          unit: 'degC',
          aggregation: { type: 'daylightWindow', params: { reduce: 'mean' } },
          normalizer: { type: 'linear', params: { from: 0, to: 20 } },
          weight: 1,
          nullPolicy: 'degrade',
        },
      ],
    });

    // The window is built from is_day, so an activity that reads a daylight
    // window cannot be scored without it (stage-four.md, section 4.2).
    expect(metricRequirements(daylit)).toContain('is_day');
  });
});
