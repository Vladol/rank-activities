-- The audit, split in two. One request produces one provenance and twenty-eight
-- outcomes (four activities over seven days); carrying the provenance on every
-- outcome row would duplicate it twenty-eight times, which is the refinement
-- data-model.md, section 2.5 records against stage-four.md, section 8.2.
CREATE TABLE computation_runs (
  request_id      uuid PRIMARY KEY,
  location_id     uuid NOT NULL REFERENCES locations(id),
  horizon_days    smallint NOT NULL CHECK (horizon_days > 0),
  profile_code    text NOT NULL,
  profile_version integer NOT NULL,
  provenance      jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX computation_runs_location_created_idx
  ON computation_runs (location_id, created_at DESC);
--> statement-breakpoint
COMMENT ON INDEX computation_runs_location_created_idx IS
  'Serves "show me the last computations for this city", which is where an incident review starts.';
--> statement-breakpoint
-- `inputs` holds aggregated feature values — what reached the normaliser and
-- what it returned — never the hourly series behind them. The series would make
-- this the forecast table the schema exists without, at some 25 KB a row
-- instead of 700 bytes.
--
-- `local_date` is nullable, which data-model.md, section 2.5 did not foresee: an
-- answer that obtained no data has no local date to hang an outcome on, and
-- those undated `no_data` rows are exactly the ones section 8 says never to
-- sample away. A synthesised date would be the day-shift the contract forbids.
CREATE TABLE computation_audit (
  id               bigint GENERATED ALWAYS AS IDENTITY,
  request_id       uuid NOT NULL REFERENCES computation_runs(request_id),
  local_date       date,
  activity_code    text NOT NULL,
  activity_version integer NOT NULL,
  outcome          text NOT NULL CHECK (outcome IN ('ranked','not_applicable','no_data')),
  score            smallint CHECK (score BETWEEN 0 AND 100),
  reason           text REFERENCES reason_codes(code),
  inputs           jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- A score exists exactly when the outcome is a ranked one. A refusal carrying
  -- a zero is the confusion the outcome union exists to prevent.
  CONSTRAINT computation_audit_ranked_has_score
    CHECK ((outcome = 'ranked' AND score IS NOT NULL) OR (outcome <> 'ranked' AND score IS NULL)),
  -- The partition key has to be part of the key of a partitioned table.
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX computation_audit_created_at_brin ON computation_audit USING brin (created_at);
--> statement-breakpoint
COMMENT ON INDEX computation_audit_created_at_brin IS
  'Serves "what happened over this period". BRIN because the table is append-only and grows in time order, so a b-tree costs more for no gain.';
--> statement-breakpoint
CREATE INDEX computation_audit_activity_date_idx ON computation_audit (activity_code, local_date);
--> statement-breakpoint
COMMENT ON INDEX computation_audit_activity_date_idx IS
  'Serves weight calibration per activity, which is the main analytical cut of this table.';
--> statement-breakpoint
-- Monthly partitions, so that retention is DROP PARTITION rather than a DELETE
-- over tens of millions of rows.
--
-- The DEFAULT partition is a safety net and nothing more: an insert must never
-- fail for want of a partition. It is also why provisioning cannot be left to
-- chance — once a row for month M has landed in the default, creating month M's
-- own partition is refused, because the rows that belong in it are already
-- somewhere else. `ensure_audit_partition` says so in as many words rather than
-- letting a deploy fail on PostgreSQL's own message.
CREATE FUNCTION ensure_audit_partition(month_start date) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  first_day date := date_trunc('month', month_start)::date;
  next_month date := (first_day + interval '1 month')::date;
  partition_name text := 'computation_audit_' || to_char(first_day, 'YYYY_MM');
  stranded bigint;
BEGIN
  IF to_regclass('public.' || partition_name) IS NOT NULL THEN
    RETURN false;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM computation_audit_unpartitioned WHERE created_at >= %L AND created_at < %L',
    first_day, next_month
  ) INTO stranded;

  IF stranded > 0 THEN
    RAISE EXCEPTION
      'cannot create partition % : % rows for that month are already in the default partition. '
      'Partition provisioning fell behind; move those rows out before creating it.',
      partition_name, stranded
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF computation_audit FOR VALUES FROM (%L) TO (%L)',
    partition_name, first_day, next_month
  );

  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE TABLE computation_audit_unpartitioned PARTITION OF computation_audit DEFAULT;
--> statement-breakpoint
-- The month before, so a clock skew at midnight on the first has somewhere to
-- go, and a year ahead, so that provisioning is a scheduled task rather than a
-- deadline. Keeping it ahead of the retention window is an operational step of
-- stage 7; `npm run db:partitions` is what performs it.
DO $$
DECLARE
  offset_months integer;
BEGIN
  FOR offset_months IN -1..12 LOOP
    PERFORM ensure_audit_partition((date_trunc('month', now()) + (offset_months || ' months')::interval)::date);
  END LOOP;
END;
$$;
