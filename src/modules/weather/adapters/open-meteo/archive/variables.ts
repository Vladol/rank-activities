import type { Result } from '../../../../../domain/shared/result';
import type { MetricCode } from '../../../../../domain/weather/metric';
import type { WeatherError } from '../../../ports/contracts';
import type { VendorVariables } from '../asked-variables';
import { forecastVariables } from '../forecast/variables';

/**
 * The archive host answers under the forecast host's variable names — the
 * difference is the model behind them and the horizon, not the vocabulary.
 *
 * So the map is the forecast map, delegated rather than copied: two lists of
 * the same names would drift, and the drift would show up as a metric that is
 * silently missing from historical answers only.
 *
 * What the archive does have of its own is the "undefined" unit: ERA5 declares
 * it for a variable the model does not carry at all and fills the series with
 * nulls (stage-three.md, section 6). The envelope accepts that only when the
 * series really is empty.
 */
export function archiveVariables(
  metrics: readonly MetricCode[],
): Result<VendorVariables, WeatherError> {
  return forecastVariables(metrics);
}
