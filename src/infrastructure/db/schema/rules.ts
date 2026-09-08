import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The published versions of the rules.
 *
 * The repository stays the source of truth — the service loads and validates
 * declarations from `seeds/` and can do so with no database at all (ADR 0007).
 * What the database adds is history: a computation recorded three weeks ago
 * names a version, and reproducing it means that version still existing and
 * still saying what it said.
 *
 * `checksum` is what makes republication safe. Publication is idempotent by
 * `(code, version)`; identical content is a no-op, and different content under
 * a version that already exists is a failed deploy rather than a silent
 * rewrite of the history every audit record points at.
 */
export const activityDefinitions = pgTable('activity_definitions', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull(),
  version: integer('version').notNull(),
  definition: jsonb('definition').notNull(),
  checksum: text('checksum').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const scoringProfiles = pgTable('scoring_profiles', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull(),
  version: integer('version').notNull(),
  weights: jsonb('weights').notNull(),
  checksum: text('checksum').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
