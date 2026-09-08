import { Logger } from '@nestjs/common';

import type { Capability } from '../../../../domain/weather/metric';
import type { SeriesPort } from '../../ports/series.port';
import { type OpenMeteoCapability, OPEN_METEO_CAPABILITIES } from './capabilities';
import { OpenMeteoPlaceLookup } from './geocoding/lookup';
import { OpenMeteoSeriesSource } from './open-meteo.source';

/**
 * The live sources as the composition root sees them: one factory per seam.
 *
 * Selecting them is an explicit act. Nothing here is the default, and nothing
 * here is substituted for a source that is missing — the module refuses to
 * start instead (`source-selection.ts`).
 */
const logger = new Logger('OpenMeteoSource');

function log(line: string): void {
  logger.warn(line);
}

export function openMeteoSeriesSource<Served extends Capability>(
  capability: Served,
): OpenMeteoSeriesSource<Served> {
  // The descriptor table is keyed by capability, and TypeScript reads that
  // lookup as the union rather than as the one entry; the cast narrows it back
  // to the capability that was asked for. `bindCapabilitySources` still checks
  // at startup that a port's own `capability` is the one it was filed under.
  const served = OPEN_METEO_CAPABILITIES[capability] as OpenMeteoCapability<Served>;

  return new OpenMeteoSeriesSource(served, { log });
}

export function openMeteoPlaceLookup(): OpenMeteoPlaceLookup {
  return new OpenMeteoPlaceLookup({ log });
}

export const OPEN_METEO_CAPABILITY_SOURCES = {
  forecast: (): SeriesPort => openMeteoSeriesSource('forecast'),
  marine: (): SeriesPort => openMeteoSeriesSource('marine'),
  archive: (): SeriesPort => openMeteoSeriesSource('archive'),
};
