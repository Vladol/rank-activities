import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The place-lookup results, which are a cache by nature and live here anyway:
 * they last thirty days, there are few of them, and they are needed before a
 * shared cache exists (data-model.md, section 2.4; open question 12.2).
 *
 * A row with `found = false` is a negative entry, and it is the reason the
 * table earns its place: without one, an enumeration of invented city names
 * reaches Open-Meteo one for one and burns the daily quota. The paired check in
 * the migration is what stops a third state — "found, with nothing found".
 */
export const placeLookups = pgTable('geocoding_cache', {
  queryNormalized: text('query_normalized').primaryKey(),
  found: boolean('found').notNull(),
  result: jsonb('result'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
