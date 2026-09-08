import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The vendor's vocabulary does not leave its package — checked, not intended.
 *
 * "Confined to two files" is the kind of claim that is true on the day it is
 * written and quietly false a month later, so it is a test rather than a
 * convention (spec `open-meteo-source`, "A vendor variable name outside the
 * adapter is a defect").
 *
 * The list is the names that are Open-Meteo's own. Names the metric dictionary
 * deliberately shares with the source — `temperature_2m`, `wind_speed_10m` —
 * are not vendor vocabulary: they are our metric codes, and they were chosen
 * to match so that a reader can follow one name from the request to the score.
 */
const VENDOR_ONLY = [
  // Daily aggregate spellings: ours is the metric, theirs is the aggregate.
  'precipitation_sum',
  'snowfall_sum',
  'rain_sum',
  'showers_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'precipitation_probability_max',
  'wave_height_max',
  'wave_period_max',
  'wave_direction_dominant',
  'swell_wave_height_max',
  // Variables no metric names.
  'relative_humidity_2m',
  'dew_point_2m',
  'pressure_msl',
  'swell_wave_height',
  'wind_wave_height',
  // Envelope keys.
  'hourly_units',
  'daily_units',
  'generationtime_ms',
  'utc_offset_seconds',
  'timezone_abbreviation',
  // Request parameters.
  'forecast_days',
  'past_days',
  'temperature_unit',
  'wind_speed_unit',
  'precipitation_unit',
  // Hosts.
  'api.open-meteo.com',
];

const ROOT = process.cwd();

/**
 * The boundary the rule draws. Both adapter packages are the vendor surface:
 * one speaks to the source and one replays what the source once said, and the
 * recorded bodies are Open-Meteo's own JSON by definition. Everything else —
 * the domain, the ports, the services, the API and the acceptance suite — has
 * no business knowing that this vendor exists.
 */
const ADAPTERS = join(ROOT, 'src/modules/weather/adapters');

function typescriptUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return path.startsWith(ADAPTERS) ? [] : typescriptUnder(path);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * Prose that explains why we never send `temperature_unit` is documentation,
 * not a dependency on it. Only whole-line comments are removed: trimming from
 * a `//` anywhere would also cut a URL in half at `https://`, and hiding a
 * hostname is exactly the leak this check exists to find.
 */
function withoutComments(source: string): string {
  return source
    .replaceAll(/\/\*[\S\s]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

describe('the vendor package contains the vendor vocabulary', () => {
  it('has no occurrence of an Open-Meteo name outside it', () => {
    const leaks: string[] = [];

    for (const path of [...typescriptUnder(join(ROOT, 'src')), ...typescriptUnder(join(ROOT, 'test'))]) {
      const source = withoutComments(readFileSync(path, 'utf8'));

      for (const name of VENDOR_ONLY) {
        if (source.includes(name)) {
          leaks.push(`${relative(ROOT, path)} names "${name}"`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });

  it('scans a set of files that could carry a leak', () => {
    // A check that scanned nothing would pass for the wrong reason.
    expect(typescriptUnder(join(ROOT, 'src')).length).toBeGreaterThan(50);
  });
});
