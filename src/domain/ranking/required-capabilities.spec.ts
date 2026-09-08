import { describe, expect, it } from 'vitest';

import type { ResolvedDefinition } from '../activity/activity-definition';
import { loadDeclarations } from '../activity/declaration.load';
import { isOk } from '../shared/result';
import { baseMetrics, requiredCapabilities } from './required-capabilities';

/**
 * Synthetic declarations, not the shipped ones: what is under test is that the
 * capabilities follow from what a declaration asks for, and a test reading
 * `seeds/` would pass for as long as surfing happens to be the only activity
 * that mentions a wave.
 */
function define(features: readonly Record<string, unknown>[]): ResolvedDefinition {
  const result = loadDeclarations(
    [{ code: 'test-activity', version: 1, titleKey: 'activity.test', features }],
    { version: 1, rules: {} },
  );

  if (!isOk(result) || result.value[0] === undefined) {
    throw new Error(
      `The fixture declaration must load: ${JSON.stringify(isOk(result) ? [] : result.error)}`,
    );
  }

  return result.value[0];
}

const warmth = {
  id: 'warmth',
  metric: 'temperature_2m',
  unit: 'degC',
  aggregation: { type: 'mean' },
  normalizer: { type: 'linear', params: { from: 0, to: 20 } },
  weight: 1,
  nullPolicy: 'degrade',
};

const waves = {
  id: 'waves',
  metric: 'wave_height',
  unit: 'm',
  aggregation: { type: 'mean' },
  normalizer: { type: 'linear', params: { from: 0, to: 4 } },
  weight: 1,
  nullPolicy: 'exclude',
};

const alignment = {
  id: 'alignment',
  metric: 'WIND_WAVE_ALIGNMENT',
  unit: 'degree',
  aggregation: { type: 'mean' },
  normalizer: { type: 'linear', params: { from: 0, to: 180 } },
  weight: 1,
  nullPolicy: 'exclude',
};

describe('what an activity depends on', () => {
  it('names only the capabilities the declaration actually reaches for', () => {
    expect([...requiredCapabilities(define([warmth])).keys()]).toEqual(['forecast']);
  });

  it('adds the marine capability exactly when a marine metric is declared', () => {
    const capabilities = requiredCapabilities(define([warmth, waves]));

    expect([...capabilities.keys()].toSorted()).toEqual(['forecast', 'marine']);
    expect(capabilities.get('marine')).toEqual(['wave_height']);
  });

  it('lists the metrics each capability owes, so a failure can say what is missing', () => {
    expect(requiredCapabilities(define([warmth, waves])).get('forecast')).toContain(
      'temperature_2m',
    );
  });

  it('splits a derived metric across the capabilities its inputs come from', () => {
    // The derivation happens on our side and no host can fail to serve it;
    // what can fail is each input, and they come from two different hosts.
    const capabilities = requiredCapabilities(define([alignment]));

    expect(capabilities.get('forecast')).toEqual(['wind_direction_10m']);
    expect(capabilities.get('marine')).toEqual(['wave_direction']);
  });

  it('replaces a derived metric with what a source is actually asked for', () => {
    expect(baseMetrics(['WIND_WAVE_ALIGNMENT'])).toEqual([
      'wind_direction_10m',
      'wave_direction',
    ]);
  });
});
