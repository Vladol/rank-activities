import type { MetricCode } from '../metric';
import type { CanonicalUnit } from '../units';
import type { MetricValues, WeatherSeries } from '../weather-series';

/**
 * The three features no source variable expresses
 * (docs/development-flow/stage-five.md, section 4). They are declared here so
 * that the planner can expand them into the metrics it must actually fetch;
 * none of them knows the name of an activity.
 *
 * The formulas arrive with the scoring (stage-five.md, section 4), together
 * with the fixture that pins the direction convention down: offshore is a
 * difference of about 180 degrees, and no amount of reasoning settles that
 * sign — only a west-coast fixture does
 * (test/acceptance/wind-wave-alignment.spec.ts).
 */
export interface DerivedMetricDefinition {
  readonly code: DerivedMetricCode;
  /** Source metrics the planner puts into the outgoing request instead. */
  readonly requires: readonly MetricCode[];
  readonly unit: CanonicalUnit;
  /**
   * The grid node the answer came from, and nothing else. Not a location
   * record: the domain knows what arrived with the series, not geography.
   */
  readonly compute: (
    inputs: readonly MetricValues[],
    context: SeriesContext,
  ) => readonly (number | null)[];
}

export interface SeriesContext {
  readonly elevationMetres: number;
}

const HALF_TURN = 180;
const FULL_TURN = 360;

/**
 * The smallest angle between two compass bearings, 0 when they agree and 180
 * when they oppose. Both bearings say where the flow comes *from*, so two
 * opposing bearings are a wind blowing straight into the swell — offshore.
 */
function angleBetween(first: number, second: number): number {
  const wrapped = (((first - second + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN;

  return Math.abs(wrapped - HALF_TURN);
}

/** Applies a formula slot by slot; a slot missing any input stays missing. */
function perSlot(
  inputs: readonly MetricValues[],
  formula: (values: readonly number[]) => number,
): readonly (number | null)[] {
  const length = inputs[0]?.length ?? 0;

  return Array.from({ length }, (_, index) => {
    const values: number[] = [];

    for (const input of inputs) {
      const value = input[index];

      if (value === null || value === undefined) {
        return null;
      }

      values.push(value);
    }

    return formula(values);
  });
}

export const DERIVED_METRICS = {
  /** Angle between wind and wave: 180 degrees is offshore, 0 is onshore. */
  WIND_WAVE_ALIGNMENT: {
    code: 'WIND_WAVE_ALIGNMENT',
    requires: ['wind_direction_10m', 'wave_direction'],
    unit: 'degree',
    compute: (inputs) => perSlot(inputs, ([wind = 0, wave = 0]) => angleBetween(wind, wave)),
  },
  /** Snow that fell below freezing. Snowfall at +8 degrees is puddles. */
  FRESH_COLD_SNOWFALL: {
    code: 'FRESH_COLD_SNOWFALL',
    requires: ['snowfall', 'temperature_2m'],
    unit: 'cm',
    compute: (inputs) =>
      perSlot(inputs, ([snowfall = 0, temperature = 0]) => (temperature < 0 ? snowfall : 0)),
  },
  /** Freezing level against the elevation of the answered grid node. */
  FREEZING_LEVEL_MARGIN: {
    code: 'FREEZING_LEVEL_MARGIN',
    requires: ['freezing_level_height'],
    unit: 'm',
    compute: (inputs, context) =>
      perSlot(inputs, ([level = 0]) => level - context.elevationMetres),
  },
} as const satisfies Record<
  string,
  {
    // Structural, not `DerivedMetricDefinition`: that interface names
    // `DerivedMetricCode`, which is read back off this very object.
    code: string;
    requires: readonly MetricCode[];
    unit: CanonicalUnit;
    compute: (
      inputs: readonly MetricValues[],
      context: SeriesContext,
    ) => readonly (number | null)[];
  }
>;

export type DerivedMetricCode = keyof typeof DERIVED_METRICS;

/**
 * What an activity may declare: a metric a source serves, or one we compute.
 * They are separate unions because a derived metric has no serving capability,
 * and the metric dictionary refuses an entry without one.
 */
export type RequirableMetric = MetricCode | DerivedMetricCode;

export function isDerivedMetric(value: string): value is DerivedMetricCode {
  return Object.hasOwn(DERIVED_METRICS, value);
}

export function derivedMetric(code: DerivedMetricCode): DerivedMetricDefinition {
  return DERIVED_METRICS[code];
}

/**
 * What the derived metrics are allowed to know about where the numbers came
 * from: the elevation of the grid node that answered, taken from the
 * provenance of the source that carried the base metric.
 */
export function seriesContextOf(series: WeatherSeries, base: MetricCode): SeriesContext {
  const carrier =
    series.provenance.find((entry) => entry.metrics.includes(base)) ?? series.provenance[0];

  return { elevationMetres: carrier?.gridPoint.elevationMetres ?? 0 };
}

/**
 * The derived channel, or `undefined` when a base metric is not on the series
 * at all. Absence stays absence: a channel of zeroes would read as data.
 */
export function computeDerived(
  code: DerivedMetricCode,
  series: WeatherSeries,
): readonly (number | null)[] | undefined {
  const definition = derivedMetric(code);
  const inputs: MetricValues[] = [];

  for (const base of definition.requires) {
    const values = series.hourly.values[base];

    if (values === undefined) {
      return undefined;
    }

    inputs.push([...values]);
  }

  const first = definition.requires[0];

  return definition.compute(inputs, seriesContextOf(series, first ?? 'temperature_2m'));
}
