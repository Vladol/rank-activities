import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MetricsRegistry } from '../../src/common/metrics/metrics.registry';
import { activityApplicability } from '../../src/domain/location/location-profile';
import type { LocationProfile } from '../../src/domain/location/location-profile';
import type { ResolvedLocation } from '../../src/domain/location/resolved-location';
import { locationId } from '../../src/domain/shared/coordinates';
import { DbLocationProfileStore } from '../../src/modules/geo/adapters/db-profile.store';
import { DbLocationStore, locationRowId } from '../../src/modules/geo/adapters/db-location.store';
import { LocationProfileService } from '../../src/modules/geo/location-profile.service';
import { MarineProbeService } from '../../src/modules/geo/marine-probe.service';
import { SnowSeasonService } from '../../src/modules/geo/snow-season.service';
import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';
import { recordingArchivePort, recordingMarinePort } from '../support/fake-series-port';
import { seedDemonstrationProfiles } from '../../src/infrastructure/db/seed/demonstration-locations';
import { seed } from '../../src/infrastructure/db/seed/seed';
import { type TestDatabase, migratedDatabase } from './support/database';

const catalogue = SeedActivityCatalogue.load();
const DAY_MS = 86_400_000;
const FIRST_DAY = Date.parse('2026-09-08T09:00:00Z');

function at(latitude: number, longitude: number, name: string, timezone: string): ResolvedLocation {
  return {
    id: locationId({ latitude, longitude }),
    coordinates: { latitude, longitude },
    timezone,
    elevationMetres: 202,
    place: { name, sourcePlaceId: `test-${name}` },
  };
}

const PRAGUE = at(50.0875, 14.4213, 'Prague', 'Europe/Prague');
const LISBON = at(38.7167, -9.1333, 'Lisbon', 'Europe/Lisbon');

const databases: TestDatabase[] = [];

afterAll(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

/**
 * One process, with its own in-memory mirror, against a store that outlives it.
 * Building a second one over the same database is what "restart" means here:
 * nothing of the first survives except what it wrote.
 */
function instance(database: TestDatabase, clock: { now: number }) {
  const marine = recordingMarinePort();
  const archive = recordingArchivePort();
  const service = new LocationProfileService(
    new DbLocationProfileStore(database.db, new MetricsRegistry()),
    new MarineProbeService(marine),
    new SnowSeasonService(archive),
    catalogue,
    new DbLocationStore(database.db),
    { now: () => clock.now },
  );

  return { service, marine, archive };
}

async function profileOf(
  database: TestDatabase,
  clock: { now: number },
  location: ResolvedLocation,
): Promise<LocationProfile> {
  const result = await instance(database, clock).service.profileFor(location);

  if (!result.ok) {
    throw new Error(`profiling ${location.id} was refused: ${result.error.code}`);
  }

  return result.value;
}

describe('the two-phase marine probe, which needs a store to terminate', () => {
  let database: TestDatabase;
  const clock = { now: FIRST_DAY };

  beforeEach(async () => {
    database = await migratedDatabase();
    databases.push(database);
    clock.now = FIRST_DAY;
  });

  it('confirms a missing coastline across two restarts, which `04` could not', async () => {
    // The scenario `04-add-location-applicability` recorded as unreachable: on a
    // process that restarts more often than daily, an in-memory probe never
    // reaches the next day, so surfing inland stayed missing-data for ever.
    const first = await profileOf(database, clock, PRAGUE);

    expect(verdict(first, 'surfing')).toEqual({ kind: 'undecided', reason: 'MARINE_UNAVAILABLE' });

    // Restart. Then tomorrow.
    clock.now += DAY_MS;

    const second = await profileOf(database, clock, PRAGUE);

    expect(verdict(second, 'surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });

    // Restart again: the decision is a fact about the place now, not a fact
    // about this process.
    clock.now += DAY_MS;

    const third = await profileOf(database, clock, PRAGUE);

    expect(verdict(third, 'surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });
  });

  it('costs no further probe once the coastline is confirmed', async () => {
    await profileOf(database, clock, PRAGUE);
    clock.now += DAY_MS;
    await profileOf(database, clock, PRAGUE);

    clock.now += DAY_MS;

    const third = instance(database, clock);
    await third.service.profileFor(PRAGUE);

    expect(third.marine.requests).toEqual([]);
  });

  it('records one probe per local date and no more, whatever a restart does', async () => {
    await profileOf(database, clock, PRAGUE);
    await profileOf(database, clock, PRAGUE);
    await profileOf(database, clock, PRAGUE);

    expect(await probeDates(database)).toEqual(['2026-09-08']);
  });

  it('makes at most one probe when concurrent requests reach one instance together', async () => {
    const only = instance(database, clock);

    await Promise.all([
      only.service.profileFor(PRAGUE),
      only.service.profileFor(PRAGUE),
      only.service.profileFor(PRAGUE),
    ]);

    expect(only.marine.requests).toHaveLength(1);
    expect(await probeDates(database)).toEqual(['2026-09-08']);
  });

  it('records at most one probe when two instances probe the same day at once', async () => {
    // Two processes have two mirrors and no shared lock, so both may probe. The
    // primary key is what makes only one of them a record, and the second
    // request then uses the recorded one (design.md, Decision 4).
    const [left, right] = [instance(database, clock), instance(database, clock)];

    await Promise.all([left.service.profileFor(PRAGUE), right.service.profileFor(PRAGUE)]);

    expect(await probeDates(database)).toEqual(['2026-09-08']);
  });

  it('stops probing a place the wave model covers, and remembers why', async () => {
    const settled = await profileOf(database, clock, LISBON);

    expect(verdict(settled, 'surfing')).toEqual({ kind: 'applicable' });

    clock.now += DAY_MS;

    const later = instance(database, clock);
    await later.service.profileFor(LISBON);

    expect(later.marine.requests).toEqual([]);
  });
});

describe('what a restart keeps', () => {
  let database: TestDatabase;
  const clock = { now: FIRST_DAY };

  beforeEach(async () => {
    database = await migratedDatabase();
    databases.push(database);
    clock.now = FIRST_DAY;
  });

  it('re-reads the evidence without a single outbound call', async () => {
    await profileOf(database, clock, LISBON);

    const restarted = instance(database, clock);
    const again = await restarted.service.profileFor(LISBON);

    expect(again.ok).toBe(true);
    expect(restarted.marine.requests).toEqual([]);
    expect(restarted.archive.requests).toEqual([]);
  });

  it('keeps the moment the evidence was computed, not the moment it was read', async () => {
    const first = await profileOf(database, clock, LISBON);

    clock.now += 60_000;

    expect((await profileOf(database, clock, LISBON)).computedAt).toBe(first.computedAt);
  });

  it('writes the place beside the evidence, so the evidence is about something', async () => {
    await profileOf(database, clock, LISBON);

    const rows = await database.db.execute<{ grid_key: string; name: string; timezone: string }>(sql`
      SELECT grid_key, name, timezone FROM locations WHERE id = ${locationRowId(LISBON.id)}::uuid
    `);

    expect(rows.rows[0]).toEqual({
      grid_key: '38.72,-9.13',
      name: 'Lisbon',
      timezone: 'Europe/Lisbon',
    });
  });

  it('stores no series of any kind', async () => {
    await profileOf(database, clock, LISBON);
    await profileOf(database, clock, PRAGUE);

    // The schema has nowhere to put one, and this is the assertion that it
    // stays that way: a table named for a forecast, a marine or an archive
    // series would be a second, worse copy of Open-Meteo (design.md, Decision 1).
    const rows = await database.db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE '%series%' OR table_name LIKE '%forecast%'
             OR table_name LIKE '%weather%' OR table_name LIKE '%hourly%')
    `);

    expect(rows.rows).toEqual([]);
  });
});

describe('an undecided snow season', () => {
  let database: TestDatabase;
  const clock = { now: FIRST_DAY };

  beforeEach(async () => {
    database = await migratedDatabase();
    databases.push(database);
    clock.now = FIRST_DAY;
  });

  it('is absent in the store, where a negative conclusion is present and false', async () => {
    // Lisbon has an archive answer and no snow: a conclusion. A location whose
    // profile carries no snow-season evidence at all has none. The two must not
    // look the same in a column an analyst reads (design.md, Decision 5).
    await profileOf(database, clock, LISBON);

    const [concluded] = (
      await database.db.execute<{ snow_season: boolean | null; snow_season_source: string | null }>(
        sql`SELECT snow_season, snow_season_source FROM location_profiles
            WHERE location_id = ${locationRowId(LISBON.id)}::uuid`,
      )
    ).rows;

    expect(concluded?.snow_season).toBe(false);
    expect(concluded?.snow_season_source).toBe('archive');

    await database.db.execute(sql`
      INSERT INTO locations (id, grid_key, name, lat, lon, timezone, geocoded_at)
      VALUES ('00000000-0000-5000-8000-000000000009'::uuid, '0.00,0.00', 'nowhere', 0, 0, 'UTC', now())
    `);
    await database.db.execute(sql`
      INSERT INTO location_profiles (location_id, evidence, rules_version, computed_at)
      VALUES ('00000000-0000-5000-8000-000000000009'::uuid, '{}'::jsonb, 1, now())
    `);

    const [ungathered] = (
      await database.db.execute<{ snow_season: boolean | null }>(
        sql`SELECT snow_season FROM location_profiles
            WHERE location_id = '00000000-0000-5000-8000-000000000009'::uuid`,
      )
    ).rows;

    expect(ungathered?.snow_season).toBeNull();
  });

  it('is a different verdict through the port, not a quieter version of the same one', async () => {
    const lisbon = await profileOf(database, clock, LISBON);

    expect(verdict(lisbon, 'ski')).toEqual({ kind: 'not_applicable', reason: 'NO_SNOW_SEASON' });
    expect(verdict({ ...lisbon, evidence: {} }, 'ski')).toEqual({
      kind: 'undecided',
      reason: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('the identity of a place', () => {
  it('is known before anything is written, and does not depend on insertion order', () => {
    // No store is consulted here at all: that is the property.
    expect(locationId({ latitude: 38.7167, longitude: -9.1333 })).toBe('38.72,-9.13');
  });

  it('is the same in two instances that share no store', async () => {
    const [left, right] = [await migratedDatabase(), await migratedDatabase()];

    databases.push(left, right);

    const clock = { now: FIRST_DAY };

    await profileOf(left, clock, LISBON);
    await profileOf(right, clock, LISBON);

    expect(await storedLocationId(left)).toBe(await storedLocationId(right));
    expect(await storedLocationId(left)).toBe(locationRowId(LISBON.id));
  });
});

function verdict(profile: LocationProfile, code: string) {
  const definition = catalogue.find(code);

  return definition === undefined ? undefined : activityApplicability(profile, definition);
}

async function storedLocationId(database: TestDatabase): Promise<string | undefined> {
  const rows = await database.db.execute<{ id: string }>(sql`SELECT id::text FROM locations`);

  return rows.rows[0]?.id;
}

async function probeDates(database: TestDatabase): Promise<readonly string[]> {
  const rows = await database.db.execute<{ local_date: string }>(
    sql`SELECT local_date::text FROM marine_probes ORDER BY 1`,
  );

  return rows.rows.map((row) => row.local_date);
}

describe('the demonstration locations', () => {
  it('are profiled offline, so a fresh checkout has a warm path', async () => {
    const database = await migratedDatabase();

    databases.push(database);
    await seed(database.db);

    const warmed = await seedDemonstrationProfiles(database.db);

    expect(warmed).toHaveLength(4);

    const rows = await database.db.execute<{ name: string; snow_season: boolean | null }>(sql`
      SELECT l.name, p.snow_season
      FROM location_profiles p JOIN locations l ON l.id = p.location_id
      ORDER BY l.name
    `);

    expect(rows.rows.map((row) => row.name)).toEqual(['Chamonix', 'Lisbon', 'Prague', 'Tromso']);
    // Chamonix has an archive fixture and a cold-season total above zero; Lisbon
    // has one and does not. Both are conclusions, and neither is a guess.
    expect(rows.rows.find((row) => row.name === 'Chamonix')?.snow_season).toBe(true);
    expect(rows.rows.find((row) => row.name === 'Lisbon')?.snow_season).toBe(false);
  });

  it('leaves an unconfirmed coastline unconfirmed rather than back-dating a probe', async () => {
    const database = await migratedDatabase();

    databases.push(database);
    await seedDemonstrationProfiles(database.db);

    const rows = await database.db.execute<{ local_date: string }>(
      sql`SELECT DISTINCT local_date::text FROM marine_probes`,
    );

    // One day, today. A second row would be a claim that somebody looked
    // yesterday, and nobody did.
    expect(rows.rows).toHaveLength(1);
  });
});
