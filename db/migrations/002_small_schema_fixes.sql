-- 002: small schema fixes on top of 001_init.sql
--
-- Applied to Supabase on 2026-09-25 (tables were empty at that time).
-- Run once, after 001, in a single transaction.

BEGIN;

-- Fix column name typo.
ALTER TABLE job_preference RENAME COLUMN work_arrangemnts TO work_arrangements;

-- These columns hold several values, so store them as text arrays
-- (e.g. '{full-time,contract}') instead of one comma-separated string.
ALTER TABLE job_preference
  ALTER COLUMN employment_types    TYPE text[] USING string_to_array(employment_types, ','),
  ALTER COLUMN preferred_roles     TYPE text[] USING string_to_array(preferred_roles, ','),
  ALTER COLUMN work_arrangements   TYPE text[] USING string_to_array(work_arrangements, ','),
  ALTER COLUMN preferred_locations TYPE text[] USING string_to_array(preferred_locations, ',');

-- Education dates are calendar dates, like work_experience.start_date/end_date.
-- Defaults are kept as before (today), only the type changes.
ALTER TABLE education
  ALTER COLUMN start_date      DROP DEFAULT,
  ALTER COLUMN graduation_date DROP DEFAULT,
  ALTER COLUMN start_date      TYPE date USING start_date::date,
  ALTER COLUMN graduation_date TYPE date USING graduation_date::date,
  ALTER COLUMN start_date      SET DEFAULT CURRENT_DATE,
  ALTER COLUMN graduation_date SET DEFAULT CURRENT_DATE;

-- A candidate can't have the same skill twice ("Python" and "python" count
-- as the same). Also speeds up loading a candidate's skills.
CREATE UNIQUE INDEX candidate_skill_candidate_skill_name_key
  ON candidate_skill (candidate_id, lower(skill_name));

COMMIT;
