import { bigint, date, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * What a computation was made of, split in two because a request produces one
 * provenance and twenty-eight outcomes (four activities over seven days).
 * Keeping the provenance and the profile version on every outcome row would
 * duplicate them twenty-eight times, which is the refinement
 * data-model.md, section 2.5 records against stage-four.md, section 8.2.
 */
export const computationRuns = pgTable('computation_runs', {
  requestId: uuid('request_id').primaryKey(),
  locationId: uuid('location_id').notNull(),
  horizonDays: smallint('horizon_days').notNull(),
  profileCode: text('profile_code').notNull(),
  profileVersion: integer('profile_version').notNull(),
  provenance: jsonb('provenance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

/**
 * One row per activity per local day.
 *
 * `inputs` holds the aggregated feature values that produced the score — the
 * number that reached the normaliser and what it returned — and never the
 * hourly series behind them. Storing the series would make the audit the
 * forecast table this schema exists without, at some 25 KB a row instead of
 * 700 bytes (data-model.md, section 2.5).
 *
 * `score` is nullable because two of the three outcomes have none. The
 * migration pairs it with the outcome in a `CHECK`, so a `not_applicable` row
 * carrying a zero cannot be written at all.
 */
export const computationAudit = pgTable('computation_audit', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity(),
  requestId: uuid('request_id').notNull(),
  localDate: date('local_date', { mode: 'string' }),
  activityCode: text('activity_code').notNull(),
  activityVersion: integer('activity_version').notNull(),
  outcome: text('outcome').notNull(),
  score: smallint('score'),
  reason: text('reason'),
  inputs: jsonb('inputs').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
