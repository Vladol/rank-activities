import type { Result } from '../../../domain/shared/result';
import type { Capability, MetricCode } from '../../../domain/weather/metric';
import type { WeatherSeries } from '../../../domain/weather/weather-series';
import type { SeriesRequest, SourceLimits, WeatherError } from './contracts';

/**
 * The seam every time-series source is reached through. One shape, three
 * capabilities: forecast, marine and archive differ in host, refresh cadence
 * and failure semantics, so each gets its own port rather than one provider
 * port with a `supports(metric)` escape hatch
 * (design.md, Decision 1 of `01-add-weather-source-contract`).
 */
export interface SeriesPort<Served extends Capability = Capability> {
  /** Stable identifier, recorded in the provenance of everything it returns. */
  readonly sourceId: string;
  readonly capability: Served;
  readonly limits: SourceLimits;

  /**
   * Whether this source can serve the metric. It must agree with what `fetch`
   * accepts — the conformance suite checks that it does, because a source that
   * over-claims turns into a silently shortened metric list.
   */
  supports(metric: MetricCode): boolean;

  /**
   * Never throws for anything originating outside the process: a transport
   * fault, a bad status, an unexpected content type, an unparseable body and a
   * schema mismatch all come back as a `WeatherError`.
   */
  fetch(request: SeriesRequest): Promise<Result<WeatherSeries, WeatherError>>;
}

export type ForecastPort = SeriesPort<'forecast'>;
export type MarinePort = SeriesPort<'marine'>;
export type ArchivePort = SeriesPort<'archive'>;
