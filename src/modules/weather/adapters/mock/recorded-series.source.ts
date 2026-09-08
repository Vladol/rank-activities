import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { Capability, MetricCode } from '../../../../domain/weather/metric';
import { type WeatherSeries, hasMetric } from '../../../../domain/weather/weather-series';
import type { SeriesRequest, SourceLimits, WeatherError } from '../../ports/contracts';
import type { SeriesPort } from '../../ports/series.port';
import { mapOpenMeteoResponse } from '../open-meteo/open-meteo.mapper';
import { validateOpenMeteoEnvelope } from '../open-meteo/open-meteo.schema';
import type { FixtureRegistry } from './fixture-registry';
import { replayRecordedBody } from './recorded-response';
import { localDateAt, rebaseTimeAxis } from './time-axis-rebaser';

/**
 * A source that answers from recorded responses instead of the network.
 *
 * It is the development default (spec `weather-mock-data`). Everything past
 * the transport is the live path: the recorded body goes through the same
 * rebaser, the same zod schema and the same mapper the Open-Meteo client will
 * use, so a green suite is a statement about data the adapter has really read
 * (design.md, Decision 1).
 */
export interface RecordedSourceOptions {
  /** The clock the current local date is taken from. Injected so tests can fix it. */
  readonly now?: () => number;
  /** Where the source's own error text goes; it is never returned to the caller. */
  readonly log?: (line: string) => void;
}

export class RecordedSeriesSource<Served extends Capability> implements SeriesPort<Served> {
  readonly sourceId: string;

  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(
    private readonly registry: FixtureRegistry,
    readonly capability: Served,
    options: RecordedSourceOptions = {},
  ) {
    this.sourceId = `recorded-${capability}`;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => undefined);
  }

  get limits(): SourceLimits {
    return this.registry.limitsFor(this.capability);
  }

  supports(metric: MetricCode): boolean {
    return this.registry.metricsFor(this.capability).includes(metric);
  }

  fetch(request: SeriesRequest): Promise<Result<WeatherSeries, WeatherError>> {
    return Promise.resolve(this.serve(request));
  }

  private serve(request: SeriesRequest): Result<WeatherSeries, WeatherError> {
    const resolved = this.registry.resolveSeries(
      this.capability,
      request.location,
      request.horizon,
    );

    if (!resolved.ok) {
      return resolved;
    }

    const replayed = replayRecordedBody(resolved.value, { log: this.log });

    if (!replayed.ok) {
      return replayed;
    }

    // A rolling forecast is moved onto the current local date of its own
    // location before it is validated, so what the schema sees is what the
    // caller gets. A request that named explicit dates keeps them: relabelling
    // 2025-07-09 as today would answer a different question than the one asked.
    const served =
      request.horizon.kind === 'forecast'
        ? rebaseTimeAxis(replayed.value, localDateAt(this.now(), offsetOf(replayed.value)))
        : replayed.value;

    const validated = validateOpenMeteoEnvelope(served);

    if (!validated.ok) {
      return err({
        ...validated.error,
        context: { ...validated.error.context, fixture: resolved.value.entry.name },
      });
    }

    const mapped = mapOpenMeteoResponse(validated.value, {
      sourceId: this.sourceId,
      capability: this.capability,
      fetchedAt: new Date(this.now()).toISOString(),
    });

    if (!mapped.ok) {
      return err({
        ...mapped.error,
        context: { ...mapped.error.context, fixture: resolved.value.entry.name },
      });
    }

    // `supports` answers for the source, which serves many places; whether a
    // particular recording carries a metric is a question about that recording.
    // Returning the series without it would be the silent shortening the source
    // contract exists to prevent (`series.port.ts`, on `supports`).
    const absent = request.metrics.filter(
      (code) => !hasMetric(mapped.value.hourly, code) && !hasMetric(mapped.value.daily, code),
    );

    if (absent.length > 0) {
      return err(
        domainError('SCHEMA_MISMATCH', 'the recording does not carry every metric asked for', {
          fixture: resolved.value.entry.name,
          missing: absent.join(', '),
        }),
      );
    }

    return ok(mapped.value);
  }
}

/**
 * The offset the recording was taken at. Read before validation because the
 * rebase needs it, and defaulted rather than trusted: a body that does not
 * carry one is about to fail the schema anyway.
 */
function offsetOf(body: unknown): number {
  if (typeof body === 'object' && body !== null) {
    const offset = (body as Record<string, unknown>).utc_offset_seconds;

    if (typeof offset === 'number') {
      return offset;
    }
  }

  return 0;
}
