import { z } from 'zod';

import { type RegistryEntry, indexByCode } from '../../shared/registry';
import type { DayWindow } from '../day-window';
import type { CanonicalUnit } from '../units';
import type { MetricValues } from '../weather-series';
import { type Predicate, evaluatePredicate, predicateSchema } from './predicate';

/**
 * The registry of docs/development-flow/stage-five.md, section 3: how one
 * metric's channel collapses into one number for one day.
 *
 * `null` on the way out means "there is no value for this day" and hands the
 * decision to the feature's null policy. Zero and `null` never mix: 0 mm of
 * precipitation is data, an empty channel is not.
 */
export interface AggregatedValue {
  readonly value: number;
  readonly unit: CanonicalUnit;
  /** How many slots of the window actually held a value. */
  readonly sampleCount: number;
  /** How many were empty — the input to the null policy and the gap rule. */
  readonly missingCount: number;
}

/** One metric's slice of a channel: its values against that channel's axis. */
export interface MetricChannel {
  readonly values: MetricValues;
  readonly unit: CanonicalUnit;
}

export interface AggregatorEntry extends RegistryEntry {
  readonly code: AggregationCode;
  readonly params: z.ZodType;
  /** Which channel the strategy reads. Checked against the metric on load. */
  readonly granularity: 'hourly' | 'daily';
  /** `same` keeps the metric's unit; anything else is a unit of its own. */
  readonly outputUnit: 'same' | CanonicalUnit;
  readonly fn: (
    channel: MetricChannel,
    window: DayWindow,
    params: unknown,
  ) => AggregatedValue | null;
}

export const AGGREGATION_CODES = [
  'mean',
  'max',
  'min',
  'sum',
  'identity',
  'daylightWindow',
  'shareOfHours',
  'countIf',
] as const;

export type AggregationCode = (typeof AGGREGATION_CODES)[number];

export const REDUCERS = ['mean', 'max', 'min', 'sum'] as const;

export type Reducer = (typeof REDUCERS)[number];

const noParams = z.union([z.object({}), z.undefined()]);
const daylightParams = z.object({ reduce: z.enum(REDUCERS) });
const windowedPredicateParams = z.object({
  predicate: predicateSchema,
  window: z.enum(['day', 'daylight']),
});

interface Slots {
  readonly present: readonly number[];
  readonly sampleCount: number;
  readonly missingCount: number;
}

/** The values of a window that are actually there, and the tally of both kinds. */
function slotsOf(channel: MetricChannel, indexes: readonly number[]): Slots {
  const present: number[] = [];
  let missingCount = 0;

  for (const index of indexes) {
    const value = channel.values[index];

    if (value === null || value === undefined) {
      missingCount += 1;
    } else {
      present.push(value);
    }
  }

  return { present, sampleCount: present.length, missingCount };
}

function reduce(values: readonly number[], reducer: Reducer): number {
  switch (reducer) {
    case 'mean':
      return values.reduce((total, value) => total + value, 0) / values.length;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'sum':
      return values.reduce((total, value) => total + value, 0);
  }
}

function reduceOver(
  channel: MetricChannel,
  indexes: readonly number[],
  reducer: Reducer,
): AggregatedValue | null {
  const slots = slotsOf(channel, indexes);

  if (slots.sampleCount === 0) {
    return null;
  }

  return {
    value: reduce(slots.present, reducer),
    unit: channel.unit,
    sampleCount: slots.sampleCount,
    missingCount: slots.missingCount,
  };
}

function indexesOf(window: DayWindow, scope: 'day' | 'daylight'): readonly number[] {
  return scope === 'day' ? window.hourIndexes : window.daylightIndexes;
}

function entry<P>(definition: {
  readonly code: AggregationCode;
  readonly params: z.ZodType<P>;
  readonly granularity: 'hourly' | 'daily';
  readonly outputUnit: 'same' | CanonicalUnit;
  readonly fn: (channel: MetricChannel, window: DayWindow, params: P) => AggregatedValue | null;
}): AggregatorEntry {
  return {
    code: definition.code,
    params: definition.params as z.ZodType,
    granularity: definition.granularity,
    outputUnit: definition.outputUnit,
    fn: (channel, window, params) => definition.fn(channel, window, params as P),
  };
}

const plainReducers = REDUCERS.map((reducer) =>
  entry<unknown>({
    code: reducer,
    params: noParams,
    granularity: 'hourly',
    outputUnit: 'same',
    fn: (channel, window) => reduceOver(channel, window.hourIndexes, reducer),
  }),
);

export const AGGREGATORS: readonly AggregatorEntry[] = [
  ...plainReducers,
  entry<unknown>({
    code: 'identity',
    params: noParams,
    granularity: 'daily',
    outputUnit: 'same',
    // The provider already did the aggregating; the day is one slot of the
    // daily axis, and a date that axis does not carry has no value.
    fn: (channel, window) =>
      window.dailyIndex === undefined ? null : reduceOver(channel, [window.dailyIndex], 'mean'),
  }),
  entry<{ reduce: Reducer }>({
    code: 'daylightWindow',
    params: daylightParams,
    granularity: 'hourly',
    outputUnit: 'same',
    // A polar night leaves this empty, and `reduceOver` answers `null` rather
    // than dividing by zero (stage-five.md, section 3).
    fn: (channel, window, params) => reduceOver(channel, window.daylightIndexes, params.reduce),
  }),
  entry<{ predicate: Predicate; window: 'day' | 'daylight' }>({
    code: 'shareOfHours',
    params: windowedPredicateParams,
    granularity: 'hourly',
    outputUnit: 'ratio',
    fn: (channel, window, params) => {
      const slots = slotsOf(channel, indexesOf(window, params.window));

      if (slots.sampleCount === 0) {
        return null;
      }

      const matching = slots.present.filter((value) => evaluatePredicate(params.predicate, value));

      return {
        value: matching.length / slots.sampleCount,
        unit: 'ratio',
        sampleCount: slots.sampleCount,
        missingCount: slots.missingCount,
      };
    },
  }),
  entry<{ predicate: Predicate; window: 'day' | 'daylight' }>({
    code: 'countIf',
    params: windowedPredicateParams,
    granularity: 'hourly',
    outputUnit: 'hour',
    fn: (channel, window, params) => {
      const slots = slotsOf(channel, indexesOf(window, params.window));

      if (slots.sampleCount === 0) {
        return null;
      }

      return {
        value: slots.present.filter((value) => evaluatePredicate(params.predicate, value)).length,
        unit: 'hour',
        sampleCount: slots.sampleCount,
        missingCount: slots.missingCount,
      };
    },
  }),
];

export const aggregatorRegistry = indexByCode('aggregation', AGGREGATORS);

export function isAggregationCode(value: string): value is AggregationCode {
  return aggregatorRegistry.has(value);
}

export function aggregatorEntry(code: AggregationCode): AggregatorEntry {
  const found = aggregatorRegistry.get(code);

  if (found === undefined) {
    throw new Error(`No aggregation is registered under "${code}".`);
  }

  return found;
}
