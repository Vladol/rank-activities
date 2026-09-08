import { beforeAll, describe, expect, it } from 'vitest';

import { computeDerived } from '../../src/domain/weather/derived/derived-metric.registry';
import { mergeSeries } from '../../src/domain/weather/merge-series';
import type { WeatherSeries } from '../../src/domain/weather/weather-series';
import { recordedSeriesSource } from '../../src/modules/weather/adapters/mock/recorded-sources';

/**
 * Open question 16.1 of docs/development-flow/stage-five.md, settled by data
 * rather than by argument.
 *
 * Open-Meteo reports both `wind_direction_10m` and `wave_direction` as the
 * direction the flow comes *from*. If that is right then on a west-facing
 * coast — Lisbon, swell out of the Atlantic at about 305 degrees — the
 * offshore wind, the one that holds a wave face up, blows from about 125
 * degrees, and that hour must score the *highest* alignment of the week while
 * the hour whose wind comes from where the swell comes from scores the lowest.
 *
 * Inverting the convention swaps those two hours, which is exactly what the
 * last assertion here refuses. No amount of reasoning settles the sign; this
 * fixture does.
 */
const LISBON = { latitude: 38.7167, longitude: -9.1333 };

const HALF_TURN = 180;
const FULL_TURN = 360;

/** The smallest angle between two bearings, without assuming the convention. */
function separation(first: number, second: number): number {
  return Math.abs((((first - second + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN - HALF_TURN);
}

interface Hour {
  readonly index: number;
  readonly wind: number;
  readonly wave: number;
  readonly alignment: number;
}

let hours: readonly Hour[];

beforeAll(async () => {
  const forecast = await recordedSeriesSource('forecast').fetch({
    capability: 'forecast',
    location: LISBON,
    metrics: ['wind_direction_10m', 'wind_speed_10m'],
    horizon: { kind: 'forecast', forecastDays: 7 },
    timezone: 'auto',
  });

  const marine = await recordedSeriesSource('marine').fetch({
    capability: 'marine',
    location: LISBON,
    metrics: ['wave_direction', 'wave_height'],
    horizon: { kind: 'forecast', forecastDays: 7 },
    timezone: 'auto',
  });

  if (!forecast.ok || !marine.ok) {
    throw new Error('The Lisbon fixtures must answer for both capabilities.');
  }

  const merged = mergeSeries(forecast.value, marine.value);

  if (!merged.ok) {
    throw new Error('The two Lisbon fixtures must merge onto one axis.');
  }

  const series: WeatherSeries = merged.value;
  const alignment = computeDerived('WIND_WAVE_ALIGNMENT', series) ?? [];
  const winds = series.hourly.values.wind_direction_10m ?? [];
  const waves = series.hourly.values.wave_direction ?? [];

  hours = winds.flatMap((wind, index) => {
    const wave = waves[index];
    const value = alignment[index];

    return wind === null || wave === null || wave === undefined || value === null || value === undefined
      ? []
      : [{ index, wind, wave, alignment: value }];
  });
});

/** The hour whose wind comes closest to `bearing`. */
function closestTo(bearing: (hour: Hour) => number): Hour {
  const found = hours.toSorted(
    (left, right) => separation(left.wind, bearing(left)) - separation(right.wind, bearing(right)),
  )[0];

  if (found === undefined) {
    throw new Error('The fixture must hold at least one hour with both directions.');
  }

  return found;
}

describe('the wind and wave direction convention, on a west-coast fixture', () => {
  it('reads the Atlantic swell as coming from the western sector', () => {
    // The premise of everything below: were the swell not westerly, no wind
    // direction would say anything about offshore.
    const waves = hours.map((hour) => hour.wave);

    expect(waves.length).toBeGreaterThan(100);
    expect(Math.min(...waves)).toBeGreaterThan(HALF_TURN);
    expect(Math.max(...waves)).toBeLessThan(FULL_TURN);
  });

  it('scores the hour whose wind opposes the swell as confidently offshore', () => {
    const offshore = closestTo((hour) => (hour.wave + HALF_TURN) % FULL_TURN);

    // 150 degrees is where surfing's curve saturates: confident offshore.
    expect(offshore.alignment, `hour ${offshore.index}, wind ${offshore.wind}`).toBeGreaterThan(150);
  });

  it('scores the hour whose wind runs with the swell as onshore', () => {
    const onshore = closestTo((hour) => hour.wave);

    expect(onshore.alignment, `hour ${onshore.index}, wind ${onshore.wind}`).toBeLessThan(20);
  });

  it('fails if the convention is inverted', () => {
    // The one assertion that dies on an inverted sign: under `180 - alignment`
    // the offshore hour would score lower than the onshore one.
    const offshore = closestTo((hour) => (hour.wave + HALF_TURN) % FULL_TURN);
    const onshore = closestTo((hour) => hour.wave);

    expect(offshore.alignment).toBeGreaterThan(onshore.alignment);
    expect(HALF_TURN - offshore.alignment).toBeLessThan(HALF_TURN - onshore.alignment);
  });
});
