import { boolean, date, doublePrecision, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * A place we have resolved, its profile, and the probes behind that profile.
 *
 * `id` is computed rather than issued: UUIDv5 over the grid key, so the same
 * city yields the same identifier before any row exists and in two processes
 * that share no store (data-model.md, section 2.3). `gridKey` is stored beside
 * it because an identifier nobody can explain is a number, not an identity.
 */
export const locations = pgTable('locations', {
  id: uuid('id').primaryKey(),
  gridKey: text('grid_key').notNull(),
  name: text('name').notNull(),
  country: text('country'),
  admin1: text('admin1'),
  latitude: doublePrecision('lat').notNull(),
  longitude: doublePrecision('lon').notNull(),
  timezone: text('timezone').notNull(),
  elevationMetres: doublePrecision('elevation_m'),
  population: integer('population'),
  providerPlaceId: text('provider_place_id'),
  geocodedAt: timestamp('geocoded_at', { withTimezone: true }).notNull(),
});

/**
 * The evidence gathered about a place, and the queryable projection of it.
 *
 * `evidence` is the truth and the only thing read back into the domain, because
 * `04-add-location-applicability` decided conclusions are derived from evidence
 * on every read: a changed threshold then re-judges what is stored without an
 * outbound call, which storing the conclusions would throw away.
 *
 * `snowSeason` is nullable and that nullability is the point: absent, positive
 * and negative are three states. Defaulting the unknown to "no snow season"
 * would present an absence of evidence as a conclusion, which is the
 * `NotApplicable`/`NoData` confusion one layer down (design.md, Decision 5).
 */
export const locationProfiles = pgTable('location_profiles', {
  locationId: uuid('location_id').primaryKey(),
  evidence: jsonb('evidence').notNull(),
  snowSeason: boolean('snow_season'),
  snowSeasonSource: text('snow_season_source'),
  rulesVersion: integer('rules_version').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
});

/**
 * One row per location per local date. The primary key is the business rule:
 * a second probe on the same day is not rejected by a service that remembers
 * to check, it is impossible (design.md, Decision 4). Two rows with different
 * dates *are* the two-phase confirmation rather than a record of it.
 */
export const marineProbes = pgTable('marine_probes', {
  locationId: uuid('location_id').notNull(),
  localDate: date('local_date', { mode: 'string' }).notNull(),
  /** true uncovered, false covered, null the probe failed and taught us nothing. */
  allNull: boolean('all_null'),
  probedAt: timestamp('probed_at', { withTimezone: true }).notNull(),
});
