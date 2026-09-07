import { CAPABILITIES, type Capability } from '../../domain/weather/metric';
import type { SeriesPort } from './ports/series.port';

/** Sources the configuration may name. Naming one is not the same as having it. */
export const WEATHER_SOURCE_NAMES = ['open-meteo', 'mock', 'record'] as const;

export type WeatherSourceName = (typeof WEATHER_SOURCE_NAMES)[number];

export type SourceFactory = () => SeriesPort;

/**
 * Which source implements which capability. Empty of real entries in this
 * change — it defines the seam; the recorded sources fill it in
 * `02-add-mock-weather-provider` and the live one in `06-add-open-meteo-source`.
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
 * The sources this build actually has. Empty here on purpose: this change
 * defines the seam and the selection mechanism, and the recorded sources
 * (`02-add-mock-weather-provider`) and the live one (`06-add-open-meteo-source`)
 * register themselves by adding an entry.
 */
export const IMPLEMENTED_SOURCES: SourceRegistry = {};
