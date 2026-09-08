import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { Capability, MetricCode } from '../../../../domain/weather/metric';
import { type WeatherSeries, hasMetric } from '../../../../domain/weather/weather-series';
import type { SeriesRequest, SourceLimits, WeatherError } from '../../ports/contracts';
import type { SeriesPort } from '../../ports/series.port';
import type { OpenMeteoCapability } from './capabilities';
import { OpenMeteoHttp, type OpenMeteoHttpOptions } from './open-meteo.http';

/**
 * The live Open-Meteo implementation of a capability port.
 *
 * It is a plain implementation of the seam and nothing more: one timeout per
 * attempt, no retry, no breaker, no cache. Those are decorators over this
 * adapter and belong to `07-add-source-caching-and-resilience`, where the
 * wrapping order is stated (design.md, Non-Goals).
 */
export class OpenMeteoSeriesSource<Served extends Capability> implements SeriesPort<Served> {
  readonly sourceId: string;
  readonly capability: Served;

  private readonly http: OpenMeteoHttp;
  private readonly now: () => number;

  constructor(
    private readonly served: OpenMeteoCapability<Served>,
    options: OpenMeteoHttpOptions = {},
  ) {
    this.sourceId = `open-meteo-${served.capability}`;
    this.capability = served.capability;
    this.http = new OpenMeteoHttp(options);
    this.now = options.now ?? (() => Date.now());
  }

  get limits(): SourceLimits {
    return this.served.limits;
  }

  supports(metric: MetricCode): boolean {
    return this.served.metrics.includes(metric) && this.served.variables([metric]).ok;
  }

  async fetch(request: SeriesRequest): Promise<Result<WeatherSeries, WeatherError>> {
    const asked = this.served.variables(request.metrics);

    if (!asked.ok) {
      return asked;
    }

    const answered = await this.http.get(this.urlFor(request, asked.value));

    if (!answered.ok) {
      return answered;
    }

    const parsed = this.served.parse(answered.value.body, asked.value);

    if (!parsed.ok) {
      return parsed;
    }

    const series = this.served.map(parsed.value, {
      sourceId: this.sourceId,
      fetchedAt: answered.value.fetchedAt,
    });

    return series.ok ? this.checkComplete(series.value, request.metrics) : series;
  }

  /** Releases the pool. The module closes its sources when the process stops. */
  close(): Promise<void> {
    return this.http.close();
  }

  /**
   * The request URL. It carries no `*_unit` parameter of any kind: a unit is
   * asserted from what the answer declares, never requested
   * (design.md, Decision 3).
   */
  private urlFor(request: SeriesRequest, asked: { hourly: readonly string[]; daily: readonly string[] }): string {
    const parameters = new URLSearchParams({
      latitude: String(request.location.latitude),
      longitude: String(request.location.longitude),
      // There is no "unset": omitting it silently answers in GMT and shifts a
      // day for anything far from it (stage-three.md, section 2.2).
      timezone: request.timezone,
    });

    if (asked.hourly.length > 0) {
      parameters.set('hourly', asked.hourly.join(','));
    }

    if (asked.daily.length > 0) {
      parameters.set('daily', asked.daily.join(','));
    }

    if (request.horizon.kind === 'forecast') {
      parameters.set('forecast_days', String(request.horizon.forecastDays));

      if (request.horizon.pastDays !== undefined) {
        parameters.set('past_days', String(request.horizon.pastDays));
      }
    } else {
      parameters.set('start_date', request.horizon.startDate);
      parameters.set('end_date', request.horizon.endDate);
    }

    return `${this.served.origin}${this.served.path}?${parameters.toString()}`;
  }

  /**
   * A metric that was asked for and did not arrive is a failure, not a shorter
   * answer. Silently shortening the metric list is what the source contract
   * exists to prevent (`series.port.ts`, on `supports`).
   */
  private checkComplete(
    series: WeatherSeries,
    metrics: readonly MetricCode[],
  ): Result<WeatherSeries, WeatherError> {
    const absent = metrics.filter(
      (code) => !hasMetric(series.hourly, code) && !hasMetric(series.daily, code),
    );

    return absent.length === 0
      ? ok(series)
      : err(
          domainError('SCHEMA_MISMATCH', 'the response does not carry every metric asked for', {
            capability: this.capability,
            missing: absent.join(', '),
          }),
        );
  }
}
