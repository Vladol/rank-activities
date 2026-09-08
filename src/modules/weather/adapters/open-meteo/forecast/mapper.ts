import type { Result } from '../../../../../domain/shared/result';
import type { WeatherSeries } from '../../../../../domain/weather/weather-series';
import type { WeatherError } from '../../../ports/contracts';
import { type MappingContext, mapOpenMeteoResponse } from '../open-meteo.mapper';
import type { OpenMeteoResponse } from '../open-meteo.schema';

/**
 * The forecast host's answer as a domain series.
 *
 * The envelope is identical across the four hosts, so the mapping itself is
 * shared (design.md, Decision 1); what belongs to the capability is which
 * capability the provenance records. Fixing it here rather than passing it in
 * is what makes "an archive response labelled as a forecast" unrepresentable
 * instead of merely unlikely.
 */
export function mapForecastResponse(
  response: OpenMeteoResponse,
  context: Omit<MappingContext, 'capability'>,
): Result<WeatherSeries, WeatherError> {
  return mapOpenMeteoResponse(response, { ...context, capability: 'forecast' });
}
