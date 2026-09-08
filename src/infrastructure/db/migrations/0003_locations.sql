-- A resolved place. `id` is UUIDv5 over `grid_key` — computed from the rounded
-- coordinates, never issued by this table — so the same city has the same
-- identity before any row exists and across instances that share no store
-- (design.md, Decision 3). `grid_key` sits beside it because an identifier that
-- cannot be explained is a number rather than an identity.
CREATE TABLE locations (
  id                uuid PRIMARY KEY,
  grid_key          text NOT NULL,
  name              text NOT NULL,
  country           text,
  admin1            text,
  lat               double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon               double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  timezone          text NOT NULL,
  elevation_m       double precision,
  population        integer,
  provider_place_id text,
  geocoded_at       timestamptz NOT NULL,
  CONSTRAINT locations_grid_key_key UNIQUE (grid_key)
);
--> statement-breakpoint
COMMENT ON INDEX locations_grid_key_key IS
  'Serves resolution of a location by its rounded coordinates. It is the identity of a place rather than an acceleration of a lookup.';
