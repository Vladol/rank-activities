-- Place lookups: a cache by nature, kept here because it lives thirty days,
-- there is little of it, and it is needed before a shared cache exists
-- (data-model.md, section 2.4 and open question 12.2).
--
-- A row with `found = false` is a negative entry, and it is why the table earns
-- its place: without one, an enumeration of invented names reaches the source
-- one for one. The CHECK forbids the third state, "found with nothing found".
CREATE TABLE geocoding_cache (
  query_normalized text PRIMARY KEY,
  found            boolean NOT NULL,
  result           jsonb,
  fetched_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  CONSTRAINT geocoding_cache_found_has_result
    CHECK ((found AND result IS NOT NULL) OR (NOT found AND result IS NULL))
);
--> statement-breakpoint
-- data-model.md, section 2.6 asks for this index partial on `expires_at < now()`.
-- It cannot be: an index predicate must be immutable and `now()` is not, so
-- PostgreSQL rejects that index rather than building a wrong one. A plain btree
-- serves the same sweep, at the cost of also indexing the live rows.
CREATE INDEX geocoding_cache_expires_at_idx ON geocoding_cache (expires_at);
--> statement-breakpoint
COMMENT ON INDEX geocoding_cache_expires_at_idx IS
  'Serves the sweep that deletes entries whose lifetime has run out: WHERE expires_at < now().';
