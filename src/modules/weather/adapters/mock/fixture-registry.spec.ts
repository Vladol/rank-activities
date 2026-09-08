import { mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { fixtureDir } from './fixture-files';
import { FixtureRegistry } from './fixture-registry';

const registry = FixtureRegistry.load();

const FORECAST_WEEK = { kind: 'forecast', forecastDays: 7 } as const;

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
  cpSync(fixtureDir(), dir, { recursive: true });

  return dir;
}

const sandboxes: string[] = [];

function scratch(): string {
  const dir = sandbox();
  sandboxes.push(dir);

  return dir;
}

afterAll(() => {
  for (const dir of sandboxes) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the fixture registry', () => {
  it('loads every recorded fixture once', () => {
    expect(registry.fixtureCount).toBeGreaterThanOrEqual(21);
  });

  it('resolves a known location to its fixture', () => {
    const resolved = registry.resolveSeries('forecast', { latitude: 38.7167, longitude: -9.1333 }, FORECAST_WEEK);

    expect(resolved.ok).toBe(true);
    expect(resolved.ok ? resolved.value.entry.name : undefined).toBe('lisbon-surf');
  });

  it('resolves a nearby coordinate that rounds the same to the same fixture', () => {
    const exact = registry.resolveSeries('forecast', { latitude: 38.7167, longitude: -9.1333 }, FORECAST_WEEK);
    const nearby = registry.resolveSeries('forecast', { latitude: 38.7201, longitude: -9.1288 }, FORECAST_WEEK);

    expect(nearby.ok).toBe(true);
    expect(nearby.ok ? nearby.value.entry.name : 'nearby').toBe(
      exact.ok ? exact.value.entry.name : 'exact',
    );
  });

  it('answers an uncovered coordinate with an explicit miss, never a neighbour', () => {
    const resolved = registry.resolveSeries('forecast', { latitude: 12.34, longitude: 56.78 }, FORECAST_WEEK);

    expect(resolved.ok).toBe(false);

    const message = resolved.ok ? '' : `${resolved.error.message} ${JSON.stringify(resolved.error.context)}`;

    expect(message).toContain('12.34:56.78');
    expect(message).toContain('record-fixture');
  });

  it('does not let one capability answer for another', () => {
    // Tromsø has a forecast recording and no marine one.
    expect(registry.resolveSeries('marine', { latitude: 69.6489, longitude: 18.9551 }, FORECAST_WEEK).ok).toBe(false);
    expect(registry.resolveSeries('forecast', { latitude: 69.6489, longitude: 18.9551 }, FORECAST_WEEK).ok).toBe(true);
  });

  it('serves the archive recording that covers the window that was asked for', () => {
    const winter = registry.resolveSeries(
      'archive',
      { latitude: 45.9237, longitude: 6.8694 },
      { kind: 'window', startDate: '2025-01-09', endDate: '2025-01-12' },
    );
    const summer = registry.resolveSeries(
      'archive',
      { latitude: 45.9237, longitude: 6.8694 },
      { kind: 'window', startDate: '2025-07-09', endDate: '2025-07-12' },
    );

    expect(winter.ok ? winter.value.entry.name : undefined).toBe('chamonix-winter-ski');
    expect(summer.ok ? summer.value.entry.name : undefined).toBe('chamonix-summer');
  });

  it('reports which windows it holds when none of them covers the request', () => {
    const resolved = registry.resolveSeries(
      'archive',
      { latitude: 45.9237, longitude: 6.8694 },
      { kind: 'window', startDate: '2025-03-01', endDate: '2025-03-07' },
    );

    expect(resolved.ok).toBe(false);
  });

  it('refuses to guess when two recordings of a place could answer a rolling horizon', () => {
    // Chamonix has a January and a July archive recording. Answering a
    // "next seven days" question with either would be picking a season.
    const resolved = registry.resolveSeries('archive', { latitude: 45.9237, longitude: 6.8694 }, FORECAST_WEEK);

    expect(resolved.ok).toBe(false);

    const context = resolved.ok ? '' : String(resolved.error.context?.recorded);

    expect(context).toContain('chamonix-winter-ski');
    expect(context).toContain('chamonix-summer');
  });

  it('still answers a rolling horizon where a place has only one recording', () => {
    const resolved = registry.resolveSeries('archive', { latitude: 25.2048, longitude: 55.2708 }, FORECAST_WEEK);

    expect(resolved.ok ? resolved.value.entry.name : undefined).toBe('dubai-heat');
  });

  it('serves an archive recording through the forecast seam when it says so', () => {
    const resolved = registry.resolveSeries('forecast', { latitude: 45.9237, longitude: 6.8694 }, FORECAST_WEEK);

    expect(resolved.ok ? resolved.value.entry.name : undefined).toBe('chamonix-winter-ski');
  });

  it('resolves a place name regardless of case and accents', () => {
    expect(registry.resolveLookup('Lisbon').ok).toBe(true);
    expect(registry.resolveLookup('lisbon').ok).toBe(true);
    expect(registry.resolveLookup('MÜNCHEN').ok).toBe(true);
    expect(registry.resolveLookup('Nowhere-at-all').ok).toBe(false);
  });

  it('declares only the metrics its recordings actually carry', () => {
    const forecast = registry.metricsFor('forecast');
    const marine = registry.metricsFor('marine');

    expect(forecast).toContain('snow_depth');
    expect(forecast).not.toContain('wave_height');
    expect(marine).toContain('wave_height');
    expect(marine).not.toContain('temperature_2m');
    // The series channel carries numbers; sunrise and sunset are ISO strings.
    expect(forecast).not.toContain('sunrise');
  });

  it('declares the horizon its recordings can actually cover', () => {
    expect(registry.limitsFor('forecast').maxForecastDays).toBe(7);
    // Nothing was recorded with past_days, so no past day can be served.
    expect(registry.limitsFor('forecast').maxPastDays).toBe(0);
    expect(registry.limitsFor('archive').earliestDate).toBe('2024-12-15');
  });

  it('refuses to start when a fixture file has no manifest entry', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'stowaway.json'), '{}', 'utf8');

    expect(() => FixtureRegistry.load(dir)).toThrow(/stowaway\.json/);
  });

  it('refuses to start when a manifest entry has no file', () => {
    const dir = scratch();
    rmSync(join(dir, 'lisbon-surf.json'));

    expect(() => FixtureRegistry.load(dir)).toThrow(/lisbon-surf/);
  });

  it('refuses to start when a recorded body no longer matches the manifest', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'lisbon-surf.json'), '{"latitude":1}', 'utf8');

    expect(() => FixtureRegistry.load(dir)).toThrow(/lisbon-surf/);
  });
});
