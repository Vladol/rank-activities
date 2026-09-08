-- A fifth reason kind. `INTERNAL_ERROR` is the code the API answers with when
-- something we did not foresee went wrong, and it belongs to none of the four
-- kinds the registry had: it is not a property of the place, of the weather, of
-- the data or of the request (`graphql-api`, "Nothing internal crosses the
-- boundary").
--
-- A CHECK rather than a PG enum is exactly why this is an ordinary migration
-- (0001_reference.sql).
ALTER TABLE reason_codes DROP CONSTRAINT reason_codes_kind_check;
--> statement-breakpoint
ALTER TABLE reason_codes ADD CONSTRAINT reason_codes_kind_check
  CHECK (kind IN ('not_applicable','constraint','no_data','request','internal'));
