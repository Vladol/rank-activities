import type { Result } from '../../../../../domain/shared/result';
import type { WeatherSeries } from '../../../../../domain/weather/weather-series';
import type { WeatherError } from '../../../ports/contracts';
import { type MappingContext, mapOpenMeteoResponse } from '../open-meteo.mapper';
import type { OpenMeteoResponse } from '../open-meteo.schema';

/**
 * The marine host's answer as a domain series, labelled as marine.
 *
 * Over land the host answers 200 with a full time axis and nothing in it. That
 * is data — "we asked, and there are no waves here" — and it maps to a present
 * series of holes rather than to a failure or to an absent metric.
 */
export function mapMarineResponse(
  response: OpenMeteoResponse,
  context: Omit<MappingContext, 'capability'>,
): Result<WeatherSeries, WeatherError> {
  return mapOpenMeteoResponse(response, { ...context, capability: 'marine' });
}
