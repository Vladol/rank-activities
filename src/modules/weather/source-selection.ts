import { CAPABILITIES, type Capability } from '../../domain/weather/metric';
import {
  RECORDED_CAPABILITY_SOURCES,
  recordedPlaceLookupSource,
} from './adapters/mock/recorded-sources';
import {
  OPEN_METEO_CAPABILITY_SOURCES,
  openMeteoPlaceLookup,
} from './adapters/open-meteo/live-sources';
import {
  RECORDING_CAPABILITY_SOURCES,
  recordingPlaceLookup,
} from './adapters/record/record-sources';
import type { PlaceLookupPort } from './ports/place-lookup.port';
import type { SeriesPort } from './ports/series.port';

/** Sources the configuration may name. Naming one is not the same as having it. */
export const WEATHER_SOURCE_NAMES = ['open-meteo', 'mock', 'record'] as const;

export type WeatherSourceName = (typeof WEATHER_SOURCE_NAMES)[number];

export type SourceFactory = () => SeriesPort;

export type PlaceLookupFactory = () => PlaceLookupPort;

/**
 * Place lookup is its own seam rather than a fourth capability, so it has its
 * own registry, selected by `WEATHER_PROVIDER` alone: there is no per-capability
 * override for something that is not a capability
 * (design.md, Decision 8 of `01-add-weather-source-contract`).
 */
export type PlaceLookupRegistry = Readonly<Partial<Record<WeatherSourceName, PlaceLookupFactory>>>;

/**
 * Which source implements which capability. The recorded sources filled it in
 * `02-add-mock-weather-provider`; the live one arrives in
 * `06-add-open-meteo-source`.
 */
export type SourceRegistry = Readonly<
  Partial<Record<WeatherSourceName, Readonly<Partial<Record<Capability, SourceFactory>>>>>
>;

export type SourceSelection = Readonly<Record<Capability, WeatherSourceName>>;

interface SourceEnv {
  readonly WEATHER_PROVIDER: WeatherSourceName;
  readonly WEATHER_FORECAST_SOURCE?: WeatherSourceName;
  readonly WEATHER_MARINE_SOURCE?: WeatherSourceName;
  readonly WEATHER_ARCHIVE_SOURCE?: WeatherSourceName;
}

const OVERRIDE_KEYS = {
  forecast: 'WEATHER_FORECAST_SOURCE',
  marine: 'WEATHER_MARINE_SOURCE',
  archive: 'WEATHER_ARCHIVE_SOURCE',
} as const;

/**
 * The source chosen per capability: one setting for all three, with an
 * override per capability so forecast and marine can come from different
 * vendors without a code change.
 */
export function selectSourceNames(env: SourceEnv): SourceSelection {
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [
      capability,
      env[OVERRIDE_KEYS[capability]] ?? env.WEATHER_PROVIDER,
    ]),
  ) as SourceSelection;
}

export interface BoundSources {
  readonly ports: readonly SeriesPort[];
  /** One line per capability, for the startup log. */
  readonly log: readonly string[];
}

/**
 * Binds the selected source per capability, or refuses to start.
 *
 * A configured source with no implementation kills the process rather than
 * quietly serving something else: a silent substitution turns "which forecast
 * is this" into a question nobody can answer afterwards
 * (spec `weather-sources`, "The active source is chosen explicitly and never
 * substituted").
 */
export function bindCapabilitySources(
  selection: SourceSelection,
  registry: SourceRegistry,
): BoundSources {
  const ports: SeriesPort[] = [];
  const log: string[] = [];

  for (const capability of CAPABILITIES) {
    const name = selection[capability];
    const factory = registry[name]?.[capability];

    if (factory === undefined) {
      throw new Error(
        `Weather source "${name}" is configured for the ${capability} capability but is not implemented. ` +
          'Configure a source that exists; the service does not substitute another one.',
      );
    }

    const port = factory();

    if (port.capability !== capability) {
      throw new Error(
        `Weather source "${name}" is registered for the ${capability} capability but its port declares ${port.capability}. ` +
          'A misfiled source would be logged as one binding and act as another.',
      );
    }

    ports.push(port);
    log.push(`${capability} capability bound to source "${name}"`);
  }

  return { ports, log };
}

/**
 * Binds the source that serves place lookup, or refuses to start, under the
 * same rule as the capabilities: a name with no implementation is a failure,
 * never a substitution.
 */
export function bindPlaceLookup(
  name: WeatherSourceName,
  registry: PlaceLookupRegistry,
): { readonly port: PlaceLookupPort; readonly log: string } {
  const factory = registry[name];

  if (factory === undefined) {
    throw new Error(
      `Weather source "${name}" is configured for place lookup but is not implemented. ` +
        'Configure a source that exists; the service does not substitute another one.',
    );
  }

  return { port: factory(), log: `place lookup bound to source "${name}"` };
}

/**
 * The sources this build actually has. The recorded ones stay the development
 * default; the live Open-Meteo client is bound only where it is named, per
 * capability, so forecast can be live while marine is still recorded.
 */
export const IMPLEMENTED_SOURCES: SourceRegistry = {
  mock: RECORDED_CAPABILITY_SOURCES,
  'open-meteo': OPEN_METEO_CAPABILITY_SOURCES,
  // The live source with a writer attached, not a third implementation.
  record: RECORDING_CAPABILITY_SOURCES,
};

export const IMPLEMENTED_PLACE_LOOKUPS: PlaceLookupRegistry = {
  mock: recordedPlaceLookupSource,
  'open-meteo': openMeteoPlaceLookup,
  record: recordingPlaceLookup,
};
