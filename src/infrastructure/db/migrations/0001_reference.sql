-- The reference registries. They are seeded from the TypeScript dictionaries
-- (`domain/weather/metric.ts`, `domain/shared/reason-code.ts`) and exist here so
-- that a recorded reason can be a foreign key rather than a free-form string.
--
-- CHECK with a value list rather than a PG enum: adding a value to an enum is
-- restricted inside a transaction and removing one is impossible, while a CHECK
-- changes by an ordinary migration (data-model.md, section 2.2).
CREATE TABLE metrics (
  code            text PRIMARY KEY,
  canonical_unit  text NOT NULL,
  granularity     text NOT NULL CHECK (granularity IN ('hourly','daily','both')),
  capability      text NOT NULL CHECK (capability IN ('forecast','marine','archive')),
  kind            text NOT NULL CHECK (kind IN ('continuous','categorical','flag')),
  plausible_min   double precision,
  plausible_max   double precision,
  CONSTRAINT metrics_plausible_range
    CHECK (plausible_min IS NULL OR plausible_max IS NULL OR plausible_min < plausible_max)
);
--> statement-breakpoint
-- The kinds are the ones `domain/shared/reason-code.ts` declares, not the
-- 'applicability'/'nodata' pair data-model.md, section 2.2 wrote. The registry is
-- the source of truth and the answer already carries these four words; a second
-- vocabulary for the same four kinds would have to be translated somewhere, and
-- that translation is what reason-code.ts exists to make unnecessary.
CREATE TABLE reason_codes (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('not_applicable','constraint','no_data','request'))
);
