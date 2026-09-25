-- Candidate Profile Service - initial schema
--
-- Snapshot of the tables as they were first created in Supabase (dashboard).
-- The database already has them: only run this file on a NEW, empty database.
-- Later schema changes go into new numbered files (002_..., 003_...).
--
-- Run with the Supabase SQL Editor or:
--   psql "$DATABASE_URL" -f db/migrations/001_init.sql
--
-- Reminder: this database belongs to the Candidate Profile Service only.
-- Other services get candidate data through the gRPC API, never via SQL or
-- the Supabase Data API.

CREATE TABLE candidate_profile (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL UNIQUE,
  first_name              varchar NOT NULL,
  last_name               varchar NOT NULL,
  headline                varchar,
  summary                 text,
  total_experience_months integer DEFAULT 0,
  province                varchar,
  country                 varchar,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_skill (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      uuid NOT NULL REFERENCES candidate_profile(id) ON DELETE CASCADE,
  skill_name        varchar NOT NULL,
  proficiency_level varchar,
  experience_months integer DEFAULT 0
);

CREATE TABLE work_experience (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidate_profile(id) ON DELETE CASCADE,
  company_name varchar NOT NULL,
  job_title    varchar NOT NULL,
  start_date   date,
  end_date     date,
  is_current   boolean NOT NULL DEFAULT false,
  description  text
);

CREATE TABLE education (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id     uuid NOT NULL UNIQUE REFERENCES candidate_profile(id) ON DELETE CASCADE,
  institution_name varchar NOT NULL,
  degree_level     varchar NOT NULL,
  field_of_study   varchar,
  start_date       timestamptz NOT NULL DEFAULT now(),
  graduation_date  timestamptz NOT NULL DEFAULT now(),
  gpa              numeric NOT NULL DEFAULT 2.5
);

CREATE TABLE job_preference (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        uuid NOT NULL UNIQUE REFERENCES candidate_profile(id) ON DELETE CASCADE,
  employment_types    varchar NOT NULL,
  preferred_roles     varchar NOT NULL,
  work_arrangemnts    varchar,
  preferred_locations varchar,
  minimum_salary      numeric NOT NULL DEFAULT 0,
  salary_currency     varchar NOT NULL
);
