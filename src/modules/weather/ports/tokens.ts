import type { Capability } from '../../../domain/weather/metric';

/**
 * Injection tokens for the capability ports. Symbols rather than strings so
 * two seams can never collide by accident, and described so that an
 * unresolved dependency names the port in the Nest error.
 */
export const FORECAST_PORT: unique symbol = Symbol('ForecastPort');
export const MARINE_PORT: unique symbol = Symbol('MarinePort');
export const ARCHIVE_PORT: unique symbol = Symbol('ArchivePort');

/** Place lookup is its own seam, not a fourth series capability (design.md, Decision 8). */
export const PLACE_LOOKUP_PORT: unique symbol = Symbol('PlaceLookupPort');

export const CAPABILITY_PORT_TOKENS: Readonly<Record<Capability, symbol>> = {
  forecast: FORECAST_PORT,
  marine: MARINE_PORT,
  archive: ARCHIVE_PORT,
};
