import { domainError } from '../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../domain/shared/result';
import type { Capability } from '../../../domain/weather/metric';
import type { SeriesRequest, SourceLimits, WeatherError } from './contracts';
import type { SeriesPort } from './series.port';

/**
 * Checks a request against what the bound source declares it accepts.
 *
 * The horizon is validated here rather than by reading the source's rejection,
 * because that rejection lies: asking Open-Meteo for 30 forecast days answers
 * `"Allowed range 0 to 16. Given 16."`
 * (docs/development-flow/stage-three.md, section 2.3).
 */
export function validateHorizon(
  request: SeriesRequest,
  limits: SourceLimits,
): Result<SeriesRequest, WeatherError> {
  if (request.horizon.kind === 'forecast') {
    const { forecastDays, pastDays } = request.horizon;

    if (forecastDays > limits.maxForecastDays) {
      return err(tooLarge(forecastDays, limits.maxForecastDays, 'forecastDays'));
    }

    if (pastDays !== undefined && pastDays > limits.maxPastDays) {
      return err(tooLarge(pastDays, limits.maxPastDays, 'pastDays'));
    }

    return ok(request);
  }

  if (request.horizon.endDate < request.horizon.startDate) {
    return err(
      domainError('HORIZON_TOO_LARGE', 'the window ends before it starts', {
        requested: request.horizon.startDate,
        allowed: request.horizon.endDate,
        unit: 'window',
      }),
    );
  }

  if (limits.earliestDate !== undefined && request.horizon.startDate < limits.earliestDate) {
    return err(
      domainError('HORIZON_TOO_LARGE', 'the window starts before the source has any record', {
        requested: request.horizon.startDate,
        allowed: limits.earliestDate,
        unit: 'startDate',
      }),
    );
  }

  return ok(request);
}

/**
 * Wraps a port so an over-long request fails locally and never leaves the
 * process. Applied once here rather than repeated in every adapter.
 */
export function guardLimits<Served extends Capability>(
  port: SeriesPort<Served>,
): SeriesPort<Served> {
  // Delegating accessors rather than a spread: an adapter written as a Nest
  // class exposes these on its prototype, and spreading would silently drop
  // them.
  return {
    get sourceId(): string {
      return port.sourceId;
    },
    get capability(): Served {
      return port.capability;
    },
    get limits(): SourceLimits {
      return port.limits;
    },
    supports: (metric) => port.supports(metric),
    fetch: async (request: SeriesRequest) => {
      const validated = validateHorizon(request, port.limits);

      return validated.ok ? port.fetch(validated.value) : validated;
    },
  };
}

function tooLarge(requested: number, allowed: number, unit: string): WeatherError {
  return domainError(
    'HORIZON_TOO_LARGE',
    `a horizon of ${requested} ${unit} exceeds the ${allowed} the source declares`,
    { requested, allowed, unit },
  );
}
