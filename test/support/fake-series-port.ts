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

/**
 * A recorded source with a scripted answer for some of its requests.
 *
 * The failure cases are the ones no recording can hold: a host that is down,
 * a host that answers slowly, an adapter that throws where the contract says
 * it must not. Everything the script does not claim falls through to the real
 * recording, so a test can make one call fail without making the place
 * fictional.
 */
export interface ScriptedSeriesPort<Served extends Capability> extends SeriesPort<Served> {
  readonly requests: readonly SeriesRequest[];
  /** Milliseconds, relative to the port's construction, per call. */
  readonly startedAt: readonly number[];
  readonly finishedAt: readonly number[];
}

export type Script = (
  request: SeriesRequest,
  /** The recording's own answer, for a script that only wants to delay it. */
  recorded: () => Promise<Result<WeatherSeries, WeatherError>>,
) => Promise<Result<WeatherSeries, WeatherError>> | undefined;

export function scriptedPort<Served extends Capability>(
  capability: Served,
  script: Script,
): ScriptedSeriesPort<Served> {
  const inner = recordedSeriesSource(capability);
  const requests: SeriesRequest[] = [];
  const startedAt: number[] = [];
  const finishedAt: number[] = [];
  const origin = performance.now();

  return {
    sourceId: inner.sourceId,
    capability: inner.capability,
    get limits(): SourceLimits {
      return inner.limits;
    },
    requests,
    startedAt,
    finishedAt,
    supports: (metric) => inner.supports(metric),
    fetch: async (request) => {
      requests.push(request);
      startedAt.push(performance.now() - origin);

      // The script runs before the await, so a `throw` in it is a throw out of
      // `fetch` — which is the misbehaving adapter a test needs to reproduce.
      const scripted = script(request, () => inner.fetch(request));
      const answer = await (scripted ?? inner.fetch(request));

      finishedAt.push(performance.now() - origin);

      return answer;
    },
  };
}

/**
 * Whether this is the marine probe rather than a ranking fetch: one metric
 * over one day (`marine-probe.service.ts`). A test that wants a coastal place
 * whose waves then fail to arrive has to let the probe through.
 */
export function isMarineProbe(request: SeriesRequest): boolean {
  return (
    request.capability === 'marine' &&
    request.metrics.length === 1 &&
    request.metrics[0] === 'wave_height'
  );
}
