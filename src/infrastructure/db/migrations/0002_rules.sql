-- The published versions of the rules. The repository stays the source of
-- truth; this is where a version becomes immutable history that an audit
-- record can point at (ADR 0007).
CREATE TABLE activity_definitions (
  id             uuid PRIMARY KEY,
  code           text    NOT NULL,
  version        integer NOT NULL CHECK (version > 0),
  definition     jsonb   NOT NULL,
  checksum       text    NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_definitions_code_version_key UNIQUE (code, version)
);
--> statement-breakpoint
COMMENT ON INDEX activity_definitions_code_version_key IS
  'Serves "give me version N of activity X" when a past computation is reproduced, and is the append-only invariant itself.';
--> statement-breakpoint
CREATE TABLE scoring_profiles (
  id             uuid PRIMARY KEY,
  code           text    NOT NULL,
  version        integer NOT NULL CHECK (version > 0),
  weights        jsonb   NOT NULL,
  checksum       text    NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scoring_profiles_code_version_key UNIQUE (code, version)
);
--> statement-breakpoint
COMMENT ON INDEX scoring_profiles_code_version_key IS
  'Serves "give me version N of profile X" for the profile version recorded on every computation run.';
--> statement-breakpoint
-- A published version is immutable, and the store is what says so.
--
-- data-model.md, section 2.7 reaches this with REVOKE UPDATE on the application
-- role. A trigger holds the same invariant without depending on which role the
-- connection happens to use, which is what makes it testable: the rejection
-- comes from the database whether the caller is the application, a migration or
-- a developer in psql.
CREATE FUNCTION reject_published_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'published version %@% is immutable; publish a new version instead of altering this one',
    OLD.code, OLD.version
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_definitions_immutable
  BEFORE UPDATE OR DELETE ON activity_definitions
  FOR EACH ROW EXECUTE FUNCTION reject_published_version_change();
--> statement-breakpoint
CREATE TRIGGER scoring_profiles_immutable
  BEFORE UPDATE OR DELETE ON scoring_profiles
  FOR EACH ROW EXECUTE FUNCTION reject_published_version_change();
