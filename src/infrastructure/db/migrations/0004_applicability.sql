-- What was concluded about a place, and the probes the conclusion rests on.
--
-- data-model.md, section 2.3 gives this table an `applicability` JSONB holding a
-- decision, a reason and an evidence blob per activity. That predates
-- `04-add-location-applicability`, whose Decision 4 settled the opposite:
-- conclusions are *derived* from evidence on every read, so that a changed
-- threshold re-judges what is stored without a single outbound call. Storing the
-- decisions as well would freeze the thing the design chose not to freeze, so
-- the column holds the evidence and carries the name of what it holds.
--
-- `evidence` is JSONB rather than a column per rule so that adding an
-- applicability rule stays what it is elsewhere in this service — data, not a
-- schema change.
CREATE TABLE location_profiles (
  location_id          uuid PRIMARY KEY REFERENCES locations(id),
  evidence             jsonb   NOT NULL,
  -- The queryable projection of the snow-season evidence, written from it and
  -- never read back into the domain. It answers "was a season observed here at
  -- all", which is a fact about the place rather than a verdict under someone's
  -- threshold: cold-season snowfall above zero, or the fallback's own judgement.
  --
  -- NULL is the third state and the reason the column is nullable: an absence of
  -- evidence must not read as a negative conclusion (design.md, Decision 5).
  snow_season          boolean,
  snow_season_source   text CHECK (snow_season_source IN ('archive','heuristic')),
  rules_version        integer NOT NULL,
  computed_at          timestamptz NOT NULL,
  -- A conclusion with no basis, or a basis with no conclusion, would each read
  -- as a decision that was never taken.
  CONSTRAINT location_profiles_snow_season_decided
    CHECK ((snow_season IS NULL) = (snow_season_source IS NULL))
);
--> statement-breakpoint
-- The primary key is the business rule rather than an acceleration: a second
-- probe for one location on one local date is impossible, not merely checked,
-- and two rows with different dates *are* the two-phase confirmation
-- (design.md, Decision 4).
--
-- `all_null` is nullable, where data-model.md, section 2.3 had it NOT NULL. Three
-- outcomes have to be told apart and a boolean holds two: the model covered the
-- place (false), the model answered a complete grid with no values (true), or
-- the probe failed and nothing was learned (NULL). Recording a failure as `true`
-- would let an outage confirm a missing coastline, which spec
-- `location-applicability` forbids in as many words; not recording it at all
-- would put a probe on every request while the source is down.
CREATE TABLE marine_probes (
  location_id uuid NOT NULL REFERENCES locations(id),
  local_date  date NOT NULL,
  all_null    boolean,
  probed_at   timestamptz NOT NULL,
  PRIMARY KEY (location_id, local_date)
);
