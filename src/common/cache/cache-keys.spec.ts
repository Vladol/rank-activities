import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { Coordinates } from '../../domain/shared/coordinates';
import type { MetricCode } from '../../domain/weather/metric';
import { MAPPER_VERSION } from '../../modules/weather/adapters/open-meteo/open-meteo.mapper';
import type { Horizon } from '../../modules/weather/ports/contracts';
import { gridKey, normalisePlaceName, placeKey, seriesKey } from './cache-keys';

const LISBON: Coordinates = { latitude: 38.7223, longitude: -9.1393 };
const FORECAST: Horizon = { kind: 'forecast', forecastDays: 7 };

function key(metrics: readonly MetricCode[], horizon: Horizon = FORECAST): string {
  return seriesKey({
    capability: 'forecast',
    location: LISBON,
    metrics,
    horizon,
    timezone: 'Europe/Lisbon',
  });
}

describe('the series key', () => {
  it('does not change with the order the metrics were listed in', () => {
    expect(key(['temperature_2m', 'wind_speed_10m'])).toBe(
      key(['wind_speed_10m', 'temperature_2m']),
    );
  });

  it('does not change with a repeated metric', () => {
    expect(key(['temperature_2m', 'temperature_2m'])).toBe(key(['temperature_2m']));
  });

  it('changes when the metric set changes', () => {
    expect(key(['temperature_2m'])).not.toBe(key(['wind_speed_10m']));
  });

  // The change that removed an entire dimension of fragmentation: the two
  // requests are the same data, and the longer answer contains the shorter.
  it('is the same for two different horizons at one location', () => {
    expect(key(['temperature_2m'], { kind: 'forecast', forecastDays: 3 })).toBe(
      key(['temperature_2m'], { kind: 'forecast', forecastDays: 7 }),
    );
  });

  it('separates an explicit window, which is a different question and not a shorter one', () => {
    const window: Horizon = { kind: 'window', startDate: '2025-01-01', endDate: '2025-01-31' };

    expect(key(['temperature_2m'], window)).not.toBe(key(['temperature_2m']));
    expect(key(['temperature_2m'], window)).toContain('2025-01-01');
  });

  // Days of history move the axis origin, so they cannot be sliced away.
  it('separates a request that prepends history', () => {
    expect(key(['temperature_2m'], { kind: 'forecast', forecastDays: 7, pastDays: 2 })).not.toBe(
      key(['temperature_2m']),
    );
  });

  it('separates the capabilities', () => {
    const base = { location: LISBON, metrics: ['temperature_2m' as MetricCode], horizon: FORECAST, timezone: 'UTC' };

    expect(seriesKey({ ...base, capability: 'forecast' })).not.toBe(
      seriesKey({ ...base, capability: 'marine' }),
    );
  });

  // The zone decides where the days fall: a series on `auto` is not the answer
  // to a request that named one.
  it('separates two time zones at one point', () => {
    const base = { capability: 'forecast' as const, location: LISBON, metrics: [], horizon: FORECAST };

    expect(seriesKey({ ...base, timezone: 'auto' })).not.toBe(
      seriesKey({ ...base, timezone: 'Europe/Lisbon' }),
    );
  });

  it('rounds coordinates onto the grid, so neighbouring requests share an entry', () => {
    expect(gridKey({ latitude: 38.7223, longitude: -9.1393 })).toBe(
      gridKey({ latitude: 38.7241, longitude: -9.1388 }),
    );
    // The negative zero folded away: it would name a second place at one point.
    expect(gridKey({ latitude: -0.001, longitude: 0 })).toBe('0.00,0.00');
  });

  it('is a function of the coordinates and not a method on them', () => {
    // A method does not survive serialisation; the object comes back
    // structurally similar and functionally dead (stage-six.md, section 4.7).
    const revived: unknown = JSON.parse(JSON.stringify(LISBON));

    expect(gridKey(revived as Coordinates)).toBe(gridKey(LISBON));
    expect(Object.values(LISBON).every((value) => typeof value !== 'function')).toBe(true);
  });
});

describe('the place key', () => {
  it('folds case, whitespace and unicode composition into one entry', () => {
    const composed = placeKey({ name: 'Chamonix' });

    expect(placeKey({ name: '  chamonix ' })).toBe(composed);
    expect(placeKey({ name: 'CHAMONIX' })).toBe(composed);
    // The same name typed on two keyboards: one code point against two.
    expect(placeKey({ name: 'Lisbóa' })).toBe(placeKey({ name: 'Lisbóa' }));
  });

  it('collapses repeated whitespace inside the name', () => {
    expect(normalisePlaceName('San   Francisco')).toBe('san francisco');
  });

  it('bounds the length of a name that becomes a key', () => {
    expect(normalisePlaceName('x'.repeat(500))).toHaveLength(120);
  });

  it('separates two languages, which answer with different names', () => {
    expect(placeKey({ name: 'Lisbon', language: 'en' })).not.toBe(
      placeKey({ name: 'Lisbon', language: 'pt' }),
    );
  });
});

describe('the mapping version namespaces every key', () => {
  it('prefixes the declared version', () => {
    expect(key(['temperature_2m'])).toMatch(new RegExp(`^v${MAPPER_VERSION}:`));
    expect(placeKey({ name: 'Lisbon' })).toMatch(new RegExp(`^v${MAPPER_VERSION}:`));
  });

  it('makes a warm entry unreachable when the version is raised', async () => {
    const warm = key(['temperature_2m']);

    vi.resetModules();
    vi.doMock('../../modules/weather/adapters/open-meteo/open-meteo.mapper', () => ({
      MAPPER_VERSION: String(Number(MAPPER_VERSION) + 1),
    }));

    // Indirect so the checker does not resolve it statically: the point is to
    // load a second copy of the module under a different mapping version.
    const modulePath = './cache-keys';
    const raised: typeof import('./cache-keys') = await import(modulePath);
    const rebuilt = raised.seriesKey({
      capability: 'forecast',
      location: LISBON,
      metrics: ['temperature_2m'],
      horizon: FORECAST,
      timezone: 'Europe/Lisbon',
    });

    vi.doUnmock('../../modules/weather/adapters/open-meteo/open-meteo.mapper');
    vi.resetModules();

    // Not "the entry is refreshed": it is not looked at, so there is nothing
    // to compare against and no way for the old mapping to be served.
    expect(rebuilt).not.toBe(warm);
  });
});

describe('keys have one origin', () => {
  it('is the only file that mints one', () => {
    const root = process.cwd();
    const minting = typescriptUnder(join(root, 'src'))
      .filter((path) => !path.endsWith('.spec.ts'))
      .filter((path) => /\bas CacheKey\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));

    // `CachePort` accepts a branded key, so this is the only way for anything
    // else to compose one — and it does not happen.
    expect(minting).toEqual(['src/common/cache/cache-keys.ts']);
  });
});

function typescriptUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return typescriptUnder(path);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}
