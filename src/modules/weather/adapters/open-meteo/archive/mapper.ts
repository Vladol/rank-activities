import type { Result } from '../../../../../domain/shared/result';
import type { WeatherSeries } from '../../../../../domain/weather/weather-series';
import type { WeatherError } from '../../../ports/contracts';
import { type MappingContext, mapOpenMeteoResponse } from '../open-meteo.mapper';
import type { OpenMeteoResponse } from '../open-meteo.schema';

/**
 * The archive host's answer as a domain series, labelled as archive.
 *
 * The mapping is the shared one: a January archive response and a forecast
 * response of the same shape produce the same numbers. Only the provenance
 * differs, and it has to — `location-applicability` asks the archive about
 * cold months and must be able to say where the answer came from.
 */
export function mapArchiveResponse(
  response: OpenMeteoResponse,
  context: Omit<MappingContext, 'capability'>,
): Result<WeatherSeries, WeatherError> {
  return mapOpenMeteoResponse(response, { ...context, capability: 'archive' });
}
