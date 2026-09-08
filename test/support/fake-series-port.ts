import type { Result } from '../../src/domain/shared/result';
import { err } from '../../src/domain/shared/result';
import type { Capability } from '../../src/domain/weather/metric';
import type { WeatherSeries } from '../../src/domain/weather/weather-series';
import type { SeriesRequest, SourceLimits, WeatherError } from '../../src/modules/weather/ports/contracts';
import type { SeriesPort } from '../../src/modules/weather/ports/series.port';
import { recordedSeriesSource } from '../../src/modules/weather/adapters/mock/recorded-sources';

/**
 * A recorded source that also keeps the requests it was given.
 *
 * The data is the real recorded body — a probe test that ran against a stub
 * would prove nothing about the all-null grid the marine endpoint really
 * answers with. What the fake adds is the request log, which is the only way
 * to assert what was *not* asked for.
 */
export interface RecordingSeriesPort<Served extends Capability> extends SeriesPort<Served> {
  readonly requests: readonly SeriesRequest[];
}

export function recordingPort<Served extends Capability>(
  capability: Served,
): RecordingSeriesPort<Served> {
  const inner = recordedSeriesSource(capability);
  const requests: SeriesRequest[] = [];

  return {
    sourceId: inner.sourceId,
    capability: inner.capability,
    get limits(): SourceLimits {
      return inner.limits;
    },
    requests,
    supports: (metric) => inner.supports(metric),
    fetch: (request) => {
      requests.push(request);

      return inner.fetch(request);
    },
  };
}

export function recordingMarinePort(): RecordingSeriesPort<'marine'> {
  return recordingPort('marine');
}

export function recordingArchivePort(): RecordingSeriesPort<'archive'> {
  return recordingPort('archive');
}

/** A source that is reachable by nothing: every request comes back as the same fault. */
export class FailingSeriesPort<Served extends Capability> implements SeriesPort<Served> {
  readonly sourceId = 'failing';

  readonly limits: SourceLimits = { maxForecastDays: 16, maxPastDays: 92, earliestDate: '1940-01-01' };

  readonly requests: SeriesRequest[] = [];

  constructor(
    readonly capability: Served,
    private readonly error: WeatherError,
  ) {}

  supports(): boolean {
    return true;
  }

  fetch(request: SeriesRequest): Promise<Result<WeatherSeries, WeatherError>> {
    this.requests.push(request);

    return Promise.resolve(err(this.error));
  }
}
