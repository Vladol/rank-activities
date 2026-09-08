import type { Coordinates } from '../../../domain/shared/coordinates';
import type { DomainError } from '../../../domain/shared/domain-error';
import type { WeatherErrorCode } from '../../../domain/shared/domain-error';
import type { Capability, MetricCode } from '../../../domain/weather/metric';

export type { Capability } from '../../../domain/weather/metric';

/**
 * Faults we detect before or instead of a call, kept apart from the six source
 * faults of `WeatherErrorCode` so that "the source failed" and "we asked for
 * something impossible" never read the same.
 */
export const REQUEST_ERROR_CODES = [
  /** The requested horizon exceeds what the bound source declares (stage-three.md, 2.3). */
  'HORIZON_TOO_LARGE',
  /** No bound source declares support for a requested metric. */
  'UNSUPPORTED_METRIC',
  /** A capability was needed and nothing is bound to it. */
  'CAPABILITY_NOT_BOUND',
] as const;

export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

/**
 * Faults of our own protection rather than of the source: the call was refused
 * before it left, and no attempt was made. They are kept apart from the six
 * source faults for the same reason as the request faults — "the source failed"
 * and "we declined to ask" must never read the same
 * (`07-add-source-caching-and-resilience`, design.md Decision 6).
 */
export const RESILIENCE_ERROR_CODES = [
  /** No outbound budget remained, or too many calls were already in flight. */
  'PROVIDER_BUSY',
  /** Repeated failures have cut this source and capability off for now. */
  'CIRCUIT_OPEN',
] as const;

export type ResilienceErrorCode = (typeof RESILIENCE_ERROR_CODES)[number];

/** Every code a port may return, source-side and our side alike. */
export type PortErrorCode = WeatherErrorCode | RequestErrorCode | ResilienceErrorCode;

/**
 * What a port returns instead of throwing. It carries our code and our
 * message; the source's own text goes to the log and no further
 * (spec `weather-sources`, "The source's own error text is never returned").
 */
export type WeatherError = DomainError<PortErrorCode>;

/** Re-exported so a port's signature reads without reaching into the core. */
export type { Coordinates } from '../../../domain/shared/coordinates';

/**
 * How far the request reaches. A rolling forecast window and an explicit date
 * window are different shapes because the sources take different parameters
 * for them (stage-three.md, sections 2.2 and 2.3).
 */
export type Horizon =
  | {
      readonly kind: 'forecast';
      /** Days ahead, including today. */
      readonly forecastDays: number;
      /** Days of history prepended to the axis. */
      readonly pastDays?: number;
    }
  | {
      readonly kind: 'window';
      /** Inclusive ISO dates, `YYYY-MM-DD`. */
      readonly startDate: string;
      readonly endDate: string;
    };

/**
 * One call to one capability. The metric list is the union the planner
 * computed, already narrowed to the metrics this capability serves.
 */
export interface SeriesRequest {
  readonly capability: Capability;
  readonly location: Coordinates;
  readonly metrics: readonly MetricCode[];
  readonly horizon: Horizon;
  /**
   * `auto` puts the series on the location's local axis. Omitting a timezone
   * would silently return GMT and shift a day for anything far from it
   * (stage-three.md, section 2.2), so the contract has no "unset".
   */
  readonly timezone: 'auto' | string;
}

/** What a source declares it can be asked for, checked before any call. */
export interface SourceLimits {
  readonly maxForecastDays: number;
  readonly maxPastDays: number;
  /** Earliest date an explicit window may start at, `YYYY-MM-DD`, when the source has one. */
  readonly earliestDate?: string;
}
