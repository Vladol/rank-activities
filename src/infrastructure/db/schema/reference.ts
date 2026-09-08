import { doublePrecision, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * The reference registries, mirrored from the TypeScript dictionaries they are
 * seeded from (`domain/weather/metric.ts`, `domain/shared/reason-code.ts`).
 *
 * They exist in the database for one reason: a foreign key. A reason recorded
 * in the audit is a code from the registry rather than a free-form string, and
 * that is an invariant only the store can hold (data-model.md, section 2.7).
 *
 * The constraints these tables carry — the value lists, the range check — live
 * in the migration rather than here. The migration is the definition; this file
 * is the typed surface a query is written against, and stating a `CHECK` twice
 * is how the two drift apart. `schema.spec.ts` holds them to each other.
 */
export const metrics = pgTable('metrics', {
  code: text('code').primaryKey(),
  canonicalUnit: text('canonical_unit').notNull(),
  granularity: text('granularity').notNull(),
  capability: text('capability').notNull(),
  kind: text('kind').notNull(),
  plausibleMin: doublePrecision('plausible_min'),
  plausibleMax: doublePrecision('plausible_max'),
});

export const reasonCodes = pgTable('reason_codes', {
  code: text('code').primaryKey(),
  kind: text('kind').notNull(),
});
