import type { Result } from '../../../../domain/shared/result';
import type { Capability, MetricCode } from '../../../../domain/weather/metric';
import { metricsOfCapability } from '../../../../domain/weather/metric';
import type { WeatherSeries } from '../../../../domain/weather/weather-series';
import type { SourceLimits, WeatherError } from '../../ports/contracts';
import { archiveVariables } from './archive/variables';
import { mapArchiveResponse } from './archive/mapper';
import { parseArchiveResponse } from './archive/schema';
import type { VendorVariables } from './asked-variables';
import { forecastVariables } from './forecast/variables';
import { mapForecastResponse } from './forecast/mapper';
import { parseForecastResponse } from './forecast/schema';
import { MARINE_METRICS, marineVariables } from './marine/variables';
import { mapMarineResponse } from './marine/mapper';
import { parseMarineResponse } from './marine/schema';
import type { MappingContext } from './open-meteo.mapper';
import type { OpenMeteoResponse } from './open-meteo.schema';

/**
 * One vendor, four hosts, one envelope.
 *
 * Forecast, marine and archive live on different hosts with different refresh
 * cadences, and each has its own variable map — but the response shape, the
 * unit table and the mapping are the same, so they ship as one package with a
 * shared transport and a descriptor per capability rather than as three
 * packages that would each keep their own copy of the same three concerns
 * (design.md, Decision 1).
 */
export interface OpenMeteoCapability<Served extends Capability = Capability> {
  readonly capability: Served;
  readonly origin: string;
  readonly path: string;
  readonly limits: SourceLimits;
  /** The metrics this host serves, and therefore what `supports` may answer. */
  readonly metrics: readonly MetricCode[];
  readonly variables: (metrics: readonly MetricCode[]) => Result<VendorVariables, WeatherError>;
  readonly parse: (body: string, asked: VendorVariables) => Result<OpenMeteoResponse, WeatherError>;
  readonly map: (
    response: OpenMeteoResponse,
    context: Omit<MappingContext, 'capability'>,
  ) => Result<WeatherSeries, WeatherError>;
}

/**
 * `forecast_days` tops out at exactly 16, and 17 answers HTTP 400
 * (`forecast-max-horizon-16.json`). The ceiling is declared here so an
 * over-long request is refused before it leaves the process: the source's own
 * rejection has been recorded saying something factually wrong
 * (stage-three.md, section 2.3).
 */
export const FORECAST_CAPABILITY: OpenMeteoCapability<'forecast'> = {
  capability: 'forecast',
  origin: 'https://api.open-meteo.com',
  path: '/v1/forecast',
  limits: { maxForecastDays: 16, maxPastDays: 92 },
  metrics: metricsOfCapability('forecast'),
  variables: forecastVariables,
  parse: parseForecastResponse,
  map: mapForecastResponse,
};

/** Marine holds the same 16 days (`marine-horizon-16.json`). */
export const MARINE_CAPABILITY: OpenMeteoCapability<'marine'> = {
  capability: 'marine',
  origin: 'https://marine-api.open-meteo.com',
  path: '/v1/marine',
  limits: { maxForecastDays: 16, maxPastDays: 92 },
  metrics: MARINE_METRICS,
  variables: marineVariables,
  parse: parseMarineResponse,
  map: mapMarineResponse,
};

/**
 * ERA5 reaches back to 1940 and lags reality by about five days
 * (stage-three.md, section 1). The earliest date is declared so a window that
 * starts before the record is refused here rather than answered with silence.
 */
export const ARCHIVE_CAPABILITY: OpenMeteoCapability<'archive'> = {
  capability: 'archive',
  origin: 'https://archive-api.open-meteo.com',
  path: '/v1/archive',
  limits: { maxForecastDays: 0, maxPastDays: 0, earliestDate: '1940-01-01' },
  metrics: metricsOfCapability('forecast'),
  variables: archiveVariables,
  parse: parseArchiveResponse,
  map: mapArchiveResponse,
};

export const OPEN_METEO_CAPABILITIES = {
  forecast: FORECAST_CAPABILITY,
  marine: MARINE_CAPABILITY,
  archive: ARCHIVE_CAPABILITY,
} as const satisfies Readonly<Record<Capability, OpenMeteoCapability>>;
