import { Logger } from '@nestjs/common';

import type { Capability } from '../../../../domain/weather/metric';
import type { PlaceLookupPort } from '../../ports/place-lookup.port';
import type { SeriesPort } from '../../ports/series.port';
import { FixtureRegistry } from './fixture-registry';
import { RecordedPlaceLookupSource } from './recorded-place-lookup.source';
import { RecordedSeriesSource } from './recorded-series.source';

/**
 * The recorded sources as the composition root sees them: one factory per
 * seam, over a fixture set that is read from disk once.
 *
 * They are the development default. Nothing here opens a socket, so `npm test`
 * and `npm run start:dev` never touch the network (spec `weather-mock-data`).
 */
export const RECORDED_SOURCE_PREFIX = 'recorded-';

let loaded: FixtureRegistry | undefined;

/** The fixture set, read at the first binding and kept for the process. */
export function recordedFixtures(): FixtureRegistry {
  loaded ??= FixtureRegistry.load();

  return loaded;
}

export function recordedFixtureCount(): number {
  return recordedFixtures().fixtureCount;
}

/**
 * Where a recorded failure's own text goes. The contract says it is logged and
 * never returned; without a sink here only the tests would hold up that half
 * of it, and a fault in a real run would be unexplainable.
 */
const logger = new Logger('RecordedWeatherSource');

function log(line: string): void {
  logger.warn(line);
}

export function recordedSeriesSource<Served extends Capability>(
  capability: Served,
): SeriesPort<Served> {
  return new RecordedSeriesSource(recordedFixtures(), capability, { log });
}

export function recordedPlaceLookupSource(): PlaceLookupPort {
  return new RecordedPlaceLookupSource(recordedFixtures(), { log });
}

export const RECORDED_CAPABILITY_SOURCES = {
  forecast: (): SeriesPort => recordedSeriesSource('forecast'),
  marine: (): SeriesPort => recordedSeriesSource('marine'),
  archive: (): SeriesPort => recordedSeriesSource('archive'),
};
