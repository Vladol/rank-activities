import type { Result } from '../../../../../domain/shared/result';
import type { WeatherError } from '../../../ports/contracts';
import { type VendorVariables, parseAskedResponse } from '../asked-variables';
import type { OpenMeteoResponse } from '../open-meteo.schema';

/** The forecast host's body, checked against the variables this call asked for. */
export function parseForecastResponse(
  body: string,
  asked: VendorVariables,
): Result<OpenMeteoResponse, WeatherError> {
  return parseAskedResponse(body, asked);
}
