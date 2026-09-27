-- 003: bring the schema to the ER diagram (docs/superpowers/specs/2026-09-27-profile-rest-crud-design.md)
--
-- Safe to re-run. Works whether the database is at 001, at 001+002, or
-- already matches the diagram. Existing data is carried over where a column
-- is replaced (first/last name -> name, province/country -> location,
-- description -> bullets, degree_level -> degree, graduation_date -> year).
--
-- Check what is live first (read-only), in the Supabase SQL Editor:
--
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('candidate_profile','candidate_skill','work_experience','education','job_preference','project')
--   ORDER BY table_name, ordinal_position;

BEGIN;

-- Helper for the conditional steps below. Dropped again at the end.
CREATE OR REPLACE FUNCTION pg_temp.has_column(tbl text, col text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = tbl AND column_name = col
  );
$$;

-- ---------------------------------------------------------------------------
-- candidate_profile
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT pg_temp.has_column('candidate_profile', 'name') THEN
    ALTER TABLE candidate_profile ADD COLUMN name varchar;
    IF pg_temp.has_column('candidate_profile', 'first_name') THEN
      EXECUTE $q$UPDATE candidate_profile
                 SET name = trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))$q$;
    END IF;
    UPDATE candidate_profile SET name = '' WHERE name IS NULL;
    ALTER TABLE candidate_profile ALTER COLUMN name SET NOT NULL;
  END IF;

  IF NOT pg_temp.has_column('candidate_profile', 'location') THEN
    ALTER TABLE candidate_profile ADD COLUMN location varchar;
    IF pg_temp.has_column('candidate_profile', 'province') THEN
      EXECUTE $q$UPDATE candidate_profile
                 SET location = nullif(concat_ws(', ', province, country), '')$q$;
    END IF;
  END IF;
END $$;

ALTER TABLE candidate_profile
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS province,
  DROP COLUMN IF EXISTS country,
  ADD COLUMN IF NOT EXISTS email varchar,
  ADD COLUMN IF NOT EXISTS links text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- candidate_skill
-- ---------------------------------------------------------------------------
ALTER TABLE candidate_skill DROP COLUMN IF EXISTS experience_months;

CREATE UNIQUE INDEX IF NOT EXISTS candidate_skill_candidate_skill_name_key
  ON candidate_skill (candidate_id, lower(skill_name));

-- ---------------------------------------------------------------------------
-- work_experience
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT pg_temp.has_column('work_experience', 'bullets') THEN
    ALTER TABLE work_experience ADD COLUMN bullets text[] NOT NULL DEFAULT '{}';
    IF pg_temp.has_column('work_experience', 'description') THEN
      EXECUTE $q$UPDATE work_experience SET bullets = ARRAY[description]
                 WHERE description IS NOT NULL AND description <> ''$q$;
    END IF;
  END IF;
END $$;

ALTER TABLE work_experience DROP COLUMN IF EXISTS description;

-- ---------------------------------------------------------------------------
-- education (a candidate can have several rows)
-- ---------------------------------------------------------------------------
ALTER TABLE education DROP CONSTRAINT IF EXISTS education_candidate_id_key;

DO $$
BEGIN
  IF NOT pg_temp.has_column('education', 'degree') THEN
    ALTER TABLE education ADD COLUMN degree varchar;
    IF pg_temp.has_column('education', 'degree_level') THEN
      EXECUTE 'UPDATE education SET degree = degree_level';
    END IF;
    UPDATE education SET degree = '' WHERE degree IS NULL;
    ALTER TABLE education ALTER COLUMN degree SET NOT NULL;
  END IF;

  IF NOT pg_temp.has_column('education', 'year') THEN
    ALTER TABLE education ADD COLUMN year varchar;
    IF pg_temp.has_column('education', 'graduation_date') THEN
      EXECUTE $q$UPDATE education SET year = extract(year FROM graduation_date)::int::text
                 WHERE graduation_date IS NOT NULL$q$;
    END IF;
  END IF;
END $$;

ALTER TABLE education
  DROP COLUMN IF EXISTS degree_level,
  DROP COLUMN IF EXISTS start_date,
  DROP COLUMN IF EXISTS graduation_date,
  ALTER COLUMN gpa DROP NOT NULL,
  ALTER COLUMN gpa DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- job_preference (002's steps, repeated behind guards, then nullability)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  col text;
BEGIN
  IF pg_temp.has_column('job_preference', 'work_arrangemnts') THEN
    ALTER TABLE job_preference RENAME COLUMN work_arrangemnts TO work_arrangements;
  END IF;

  FOREACH col IN ARRAY ARRAY['employment_types', 'preferred_roles', 'work_arrangements', 'preferred_locations'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'job_preference'
        AND column_name = col AND data_type <> 'ARRAY'
    ) THEN
      EXECUTE format('ALTER TABLE job_preference ALTER COLUMN %I TYPE text[] USING string_to_array(%I, '','')', col, col);
    END IF;
  END LOOP;
END $$;

ALTER TABLE job_preference
  ALTER COLUMN preferred_roles DROP NOT NULL,
  ALTER COLUMN minimum_salary DROP NOT NULL,
  ALTER COLUMN minimum_salary DROP DEFAULT,
  ALTER COLUMN salary_currency DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- project (new)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidate_profile(id) ON DELETE CASCADE,
  name         varchar NOT NULL,
  tech         text[] NOT NULL DEFAULT '{}',
  bullets      text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS project_candidate_id_idx ON project (candidate_id);

DROP FUNCTION pg_temp.has_column(text, text);

COMMIT;
