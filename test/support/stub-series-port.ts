import type { Result } from '../../src/domain/shared/result';
import { ok } from '../../src/domain/shared/result';
import type { Capability, MetricCode } from '../../src/domain/weather/metric';
import type { WeatherSeries } from '../../src/domain/weather/weather-series';
import type {
  SeriesRequest,
  SourceLimits,
  WeatherError,
} from '../../src/modules/weather/ports/contracts';
import type { SeriesPort } from '../../src/modules/weather/ports/series.port';

/**
 * A source whose answer the test decides, call by call.
 *
 * The recorded sources are the right fake for anything about the *data*; this
 * one exists for everything about the *call* — how many were made, when, and
 * what happened when one failed. Those are the questions the caching and
 * resilience layer is made of.
 */
export interface StubSeriesPort<Served extends Capability> extends SeriesPort<Served> {
  readonly requests: readonly SeriesRequest[];
  /** Replaceable at any point, so a source can go down mid-test. */
  answer: (request: SeriesRequest) => Promise<Result<WeatherSeries, WeatherError>>;
}

export function stubPort<Served extends Capability>(
  capability: Served,
  options: {
    readonly sourceId?: string;
    readonly limits?: SourceLimits;
    readonly answer?: (request: SeriesRequest) => Promise<Result<WeatherSeries, WeatherError>>;
  } = {},
): StubSeriesPort<Served> {
  const requests: SeriesRequest[] = [];
  const port: StubSeriesPort<Served> = {
    sourceId: options.sourceId ?? `stub-${capability}`,
    capability,
    limits: options.limits ?? { maxForecastDays: 16, maxPastDays: 92, earliestDate: '1940-01-01' },
    requests,
    answer:
      options.answer ??
      ((request) => Promise.resolve(ok(stubSeries({ capability, request })))),
    supports: () => true,
    fetch: (request) => {
      requests.push(request);

      return port.answer(request);
    },
  };

  return port;
}

/**
 * A series that covers the days the request asked for, with one metric per
 * asked-for code and a hole in every second hour. The hole is deliberate: a
 * value that travels through the cache and comes back as `0` is the failure
 * the codec contract exists to prevent.
 */
export function stubSeries(input: {
  readonly capability: Capability;
  readonly request?: SeriesRequest;
  readonly days?: number;
  readonly fetchedAt?: string;
  readonly sourceId?: string;
  readonly metrics?: readonly MetricCode[];
  readonly firstDate?: string;
}): WeatherSeries {
  const days =
    input.days ??
    (input.request?.horizon.kind === 'forecast' ? input.request.horizon.forecastDays : 1);
  const metrics = input.metrics ?? input.request?.metrics ?? (['temperature_2m'] as MetricCode[]);
  const start = Date.parse(`${input.firstDate ?? '2026-03-01'}T00:00:00Z`);
  const dates = Array.from({ length: days }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
  const hourly = dates.flatMap((date) => [`${date}T00:00`, `${date}T12:00`]);

  return {
    hourly: {
      time: hourly,
      values: Object.fromEntries(
        metrics.map((code) => [code, hourly.map((_, index) => (index % 2 === 0 ? index : null))]),
      ),
    },
    daily: { time: dates, values: {} },
    provenance: [
      {
        sourceId: input.sourceId ?? `stub-${input.capability}`,
        capability: input.capability,
        gridPoint: { latitude: 38.72, longitude: -9.14, elevationMetres: 10 },
        fetchedAt: input.fetchedAt ?? '2026-03-01T10:00:00.000Z',
        stale: false,
        metrics,
        timezone: 'Europe/Lisbon',
      },
    ],
  };
}
