-- 003: store the profile the way the frontend sends it
--
-- Applied to Supabase on 2026-09-26 (tables were empty at that time).
-- Rule: if converting a frontend value back into columns would be a guess
-- (e.g. splitting a full name), store the value as the frontend sends it.

BEGIN;

-- candidate_profile ----------------------------------------------------------
-- One `name` instead of first/last: the frontend only sends a full name.
ALTER TABLE candidate_profile
  DROP COLUMN first_name,
  DROP COLUMN last_name,
  ADD COLUMN name varchar NOT NULL;

-- One `location` text instead of province/country (e.g. 'Bangkok, Thailand').
ALTER TABLE candidate_profile
  DROP COLUMN province,
  DROP COLUMN country,
  ADD COLUMN location varchar;

ALTER TABLE candidate_profile
  ADD COLUMN email varchar,
  ADD COLUMN links text[] NOT NULL DEFAULT '{}',
  -- true once the candidate has confirmed the data extracted from a resume
  ADD COLUMN verified boolean NOT NULL DEFAULT false;

-- candidate_skill --------------------------------------------------------------
ALTER TABLE candidate_skill DROP COLUMN experience_months;

-- work_experience --------------------------------------------------------------
-- The frontend shows experience as bullet points, not one description text.
ALTER TABLE work_experience
  DROP COLUMN description,
  ADD COLUMN bullets text[] NOT NULL DEFAULT '{}';

-- education --------------------------------------------------------------------
-- A candidate can have several degrees.
ALTER TABLE education DROP CONSTRAINT education_candidate_id_key;

ALTER TABLE education RENAME COLUMN degree_level TO degree;

-- Free text year or range, as entered (e.g. '2026' or '2022 - 2026').
ALTER TABLE education
  DROP COLUMN start_date,
  DROP COLUMN graduation_date,
  ADD COLUMN year varchar;

-- GPA is optional: no made-up default when a resume doesn't mention it.
ALTER TABLE education
  ALTER COLUMN gpa DROP NOT NULL,
  ALTER COLUMN gpa DROP DEFAULT;

-- job_preference ---------------------------------------------------------------
-- The frontend doesn't send these, so they can't be required.
ALTER TABLE job_preference
  ALTER COLUMN preferred_roles DROP NOT NULL,
  ALTER COLUMN salary_currency DROP NOT NULL,
  ALTER COLUMN employment_types SET DEFAULT '{}',
  ALTER COLUMN minimum_salary DROP NOT NULL,
  ALTER COLUMN minimum_salary DROP DEFAULT;

-- project (new) ----------------------------------------------------------------
CREATE TABLE project (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidate_profile(id) ON DELETE CASCADE,
  name         varchar NOT NULL,
  tech         text[] NOT NULL DEFAULT '{}',
  bullets      text[] NOT NULL DEFAULT '{}'
);

COMMIT;
