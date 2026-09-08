import { Logger } from '@nestjs/common';

import type { Capability } from '../../../../domain/weather/metric';
import type { PlaceLookupPort } from '../../ports/place-lookup.port';
import type { SeriesPort } from '../../ports/series.port';
import { type OpenMeteoCapability, OPEN_METEO_CAPABILITIES } from '../open-meteo/capabilities';
import { OpenMeteoPlaceLookup } from '../open-meteo/geocoding/lookup';
import type { ObservedResponse } from '../open-meteo/open-meteo.http';
import { OpenMeteoSeriesSource } from '../open-meteo/open-meteo.source';
import { FixtureWriter } from './fixture-writer';

/**
 * The recording mode: the live source with a writer attached.
 *
 * It is a decorator over the live adapter and not a source of its own. A
 * separate implementation would read more directly in the module wiring, and it
 * would also let a fixture be recorded through a code path that differs from
 * the one it is later meant to describe — which would make the fixture set
 * quietly wrong in exactly the way it exists to prevent
 * (design.md, Decision 6).
 *
 * It is never the default. `WEATHER_PROVIDER=record` has to be asked for, and
 * the writer refuses to replace a recording unless replacement was asked for
 * too.
 */
export interface RecordingOptions {
  readonly writer?: FixtureWriter;
  /** Overridden only by the tests, which point the source at a local server. */
  readonly origin?: string;
  /** Files a locally served response under the host it stands in for. */
  readonly rewriteUrl?: (url: string) => string;
  readonly log?: (line: string) => void;
}

const logger = new Logger('RecordingWeatherSource');

function defaultLog(line: string): void {
  logger.warn(line);
}

function observer(
  writer: FixtureWriter,
  log: (line: string) => void,
  rewriteUrl: (url: string) => string,
): (response: ObservedResponse) => void {
  return (response) => {
    const written = writer.write({ ...response, url: rewriteUrl(response.url) });

    // Recording is a side effect of serving. A fixture that cannot be written
    // is reported and nothing more: whoever asked for the forecast still gets
    // one.
    log(
      written.ok
        ? `recorded fixture "${written.value.name}" from ${response.url}`
        : written.error,
    );
  };
}

export function recordingSeriesSource<Served extends Capability>(
  capability: Served,
  options: RecordingOptions = {},
): OpenMeteoSeriesSource<Served> {
  const served = OPEN_METEO_CAPABILITIES[capability] as OpenMeteoCapability<Served>;
  const log = options.log ?? defaultLog;

  return new OpenMeteoSeriesSource(
    options.origin === undefined ? served : { ...served, origin: options.origin },
    {
      log,
      observe: observer(
        options.writer ?? new FixtureWriter(replacement()),
        log,
        options.rewriteUrl ?? ((url) => url),
      ),
    },
  );
}

export function recordingPlaceLookup(options: RecordingOptions = {}): PlaceLookupPort {
  const log = options.log ?? defaultLog;

  return new OpenMeteoPlaceLookup({
    log,
    observe: observer(
      options.writer ?? new FixtureWriter(replacement()),
      log,
      options.rewriteUrl ?? ((url) => url),
    ),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
}

/**
 * Overwriting a recording is a deliberate act, asked for by its own variable
 * rather than implied by choosing to record at all.
 *
 * It is read from the environment here rather than injected because a source
 * factory in the registry takes no arguments (`source-selection.ts`). The
 * variable is declared and validated in `src/config/env.schema.ts` all the
 * same, so a malformed value still fails at startup rather than at the first
 * recording.
 */
function replacement(): { readonly replace: boolean } {
  return { replace: process.env.WEATHER_RECORD_REPLACE === 'true' };
}

export const RECORDING_CAPABILITY_SOURCES = {
  forecast: (): SeriesPort => recordingSeriesSource('forecast'),
  marine: (): SeriesPort => recordingSeriesSource('marine'),
  archive: (): SeriesPort => recordingSeriesSource('archive'),
};
