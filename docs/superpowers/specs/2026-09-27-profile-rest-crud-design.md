# Candidate Profile Service — REST CRUD Design

**Date:** 2026-09-27
**Status:** Approved in brainstorming, pending written-spec review
**Related specs:** `rolefit-frontend/docs/superpowers/specs/2026-09-27-backend-integration-design.md` (system overview, frontend), `rolefit-job-posting-service/docs/superpowers/specs/2026-09-27-job-posting-grpc-design.md`

## Goal

Replace the scaffold's `NotImplementedError` placeholders with a working Candidate Profile Service. The web frontend calls it directly from the browser over **REST/JSON** and gets full CRUD on every table in the ER diagram. The internal gRPC `GetProfile` is updated to the same data so Job Discovery can use it later.

## Non-goals

- Real authentication. Identity is a mock `X-User-Id` header (see [Identity](#identity)).
- A real AI provider, or text extraction from PDF/DOCX. The AI adapter stays a deterministic placeholder.
- REST access to other users' profiles. Service-to-service reads go through gRPC.

## Data model

The target is the ER diagram. Postgres on Supabase; this service is the only client.

| Table | Columns (NOT NULL in **bold**) |
|---|---|
| `candidate_profile` | **id** uuid PK (the owner's user id; there is no separate `user_id` column), **name** varchar, headline varchar, summary text, total_experience_months int4, email varchar, location varchar, **links** text[] default `{}`, **verified** bool default false, **created_at**, **updated_at** timestamptz |
| `candidate_skill` | **id**, **candidate_id** FK, **skill_name** varchar, proficiency_level varchar. Unique index on `(candidate_id, lower(skill_name))` |
| `work_experience` | **id**, **candidate_id** FK, **company_name**, **job_title** varchar, start_date date, end_date date, **is_current** bool, **bullets** text[] default `{}` |
| `education` | **id**, **candidate_id** FK (not unique), **institution_name**, **degree** varchar, field_of_study varchar, gpa numeric, year varchar |
| `job_preference` | **id**, **candidate_id** FK UNIQUE, **employment_types** text[], preferred_roles text[], work_arrangements text[], preferred_locations text[], minimum_salary numeric, salary_currency varchar |
| `project` | **id**, **candidate_id** FK, **name** varchar, **tech** text[] default `{}`, **bullets** text[] default `{}` |

All child foreign keys are `ON DELETE CASCADE`.

### Migration `db/migrations/003_match_er_diagram.sql`

It isn't known whether the live database is at 001, at 001+002, or already matches the diagram. So 003 **brings all three states to the diagram**, is safe to run more than once, and runs in one transaction:

- It repeats 002's steps behind guards: the column rename, `text[]` conversions, and the case-insensitive skill index.
- `candidate_profile`: drop `first_name`, `last_name`, `province`, `country` if they exist. Add `name`, `email`, `location`, `links`, `verified` if missing. `name` gets a temporary default of `''` so existing rows pass the NOT NULL check; the default is then removed.
- `candidate_skill`: drop `experience_months` if it exists.
- `work_experience`: drop `description` and add `bullets` if missing.
- `education`: drop the `UNIQUE(candidate_id)` constraint. Drop `degree_level`, `start_date`, `graduation_date`. Add `degree` and `year`. Make `gpa` nullable with no default.
- `job_preference`: make `preferred_roles`, `minimum_salary` and `salary_currency` nullable, and drop the `minimum_salary` default.
- `project`: `CREATE TABLE IF NOT EXISTS`, plus an index on `candidate_id`.

The migration file begins with a read-only check query (commented out) to run first in the SQL Editor:

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('candidate_profile','candidate_skill','work_experience','education','job_preference','project')
ORDER BY table_name, ordinal_position;
```

### Ordering

There's no position column, so the API returns rows in this fixed order:

- experience: `is_current DESC, start_date DESC NULLS LAST`
- education: `year DESC NULLS LAST`
- projects and skills: `lower(name) ASC`

## Shared vocabulary

Values are stored and sent as these exact strings. The Job Posting Service uses the same values, so matching works across both services.

| Field | Values |
|---|---|
| `proficiencyLevel` | `BASIC`, `INTERMEDIATE`, `ADVANCED` |
| `employmentTypes` | `FULL_TIME`, `PART_TIME`, `INTERNSHIP`, `CONTRACT` |
| `workArrangements` | `ONSITE`, `HYBRID`, `REMOTE` |

## Identity

Auth is mocked for now, so each request identifies itself:

- Every `/api/profiles/*` request must send `X-User-Id: <uuid>`. `src/middleware/identity.middleware.ts` puts it on `req.userId`. If the header is missing or isn't a UUID, the request gets **401 `UNAUTHENTICATED`**.
- The header is trusted only because auth is mocked. When real auth arrives, this middleware becomes JWT verification that sets the same `req.userId`, and nothing else changes.
- Every route works on the caller's own profile (`/me`). A profile's `id` is its owner's user id, so the lookup is `WHERE id = <caller's user id>`. A client can't name another user's profile.

## CORS

`src/middleware/cors.middleware.ts` is hand-written, with no new dependency:

- It allows the single origin in the `CORS_ORIGIN` env var (default `http://localhost:3000`).
- Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.
- Headers: `Content-Type, X-User-Id, X-File-Name`.
- Preflight `OPTIONS` requests get **204**.

## REST API

Base path `/api/profiles`. Every route sends and receives JSON, except `import-resume`.

### Profile

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/me` | `ProfileBasicsInput` | 201 `Profile` (`verified=false`) | 409 `PROFILE_ALREADY_EXISTS` |
| GET | `/me` | — | 200 `Profile` | 404 `PROFILE_NOT_FOUND` |
| PATCH | `/me` | `Partial<ProfileBasicsInput>` | 200 `Profile` | 404 |
| DELETE | `/me` | — | 204 (child rows deleted too) | 404 |

In a PATCH, a field that's present is set and a field that's absent is left alone. `null` clears a nullable field; `name` can't be null.

### Child collections

Every child route returns **404 `PROFILE_NOT_FOUND`** if the caller has no profile. An `:id` that isn't a UUID, or doesn't belong to the caller, returns the collection's not-found code.

| Collection | Path | Body | Not-found code |
|---|---|---|---|
| Skills | `/me/skills` | `SkillInput` | `SKILL_NOT_FOUND` |
| Experience | `/me/experience` | `ExperienceInput` | `EXPERIENCE_NOT_FOUND` |
| Education | `/me/education` | `EducationInput` | `EDUCATION_NOT_FOUND` |
| Projects | `/me/projects` | `ProjectInput` | `PROJECT_NOT_FOUND` |

For each collection:

- `GET /me/<c>` returns 200 with the array.
- `POST /me/<c>` returns 201 with the created item.
- `PUT /me/<c>/:id` replaces that row and returns 200 with the item.
- `DELETE /me/<c>/:id` returns 204.

Skills also return **409 `DUPLICATE_SKILL`** when the name already exists, ignoring case.

### Preferences (one per profile)

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/me/preferences` | — | 200 `Preferences` | 404 `PREFERENCES_NOT_FOUND` |
| PUT | `/me/preferences` | `PreferencesInput` | 200 `Preferences` (creates or updates) | — |
| DELETE | `/me/preferences` | — | 204 | 404 `PREFERENCES_NOT_FOUND` |

### Resume import and confirm

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/me/import-resume` | raw file bytes; `Content-Type` = PDF, DOC or DOCX; `X-File-Name` header | 200 `{ fileName, profile: ProfileDocumentInput }`. **Nothing is saved.** No existing profile is needed. | 400 empty body, 413 `FILE_TOO_LARGE` (> 5 MB), 415 `UNSUPPORTED_FILE_TYPE` |
| POST | `/me/confirm` | `ProfileDocumentInput` | 200 `Profile` with `verified=true` | 400 |

`confirm` creates the profile if it doesn't exist. Otherwise it replaces the basics and **all** child rows. Either way it's one transaction.

`import-resume` accepts these types, read with `express.raw({ limit: '5mb' })` on this route only:

- `application/pdf`
- `application/msword`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

### Shapes

```ts
type ProficiencyLevel = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED';
type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'INTERNSHIP' | 'CONTRACT';
type WorkArrangement = 'ONSITE' | 'HYBRID' | 'REMOTE';

interface ProfileBasicsInput {
  name: string; headline?: string | null; summary?: string | null;
  email?: string | null; location?: string | null; links?: string[];
}
interface SkillInput { name: string; proficiencyLevel?: ProficiencyLevel | null }
interface ExperienceInput {
  companyName: string; jobTitle: string;
  startDate?: string | null; endDate?: string | null;   // YYYY-MM-DD
  isCurrent: boolean; bullets?: string[];
}
interface EducationInput {
  institutionName: string; degree: string; fieldOfStudy?: string | null;
  gpa?: number | null; year?: string | null;            // year = 'YYYY'
}
interface ProjectInput { name: string; tech?: string[]; bullets?: string[] }
interface PreferencesInput {
  employmentTypes: EmploymentType[];                     // at least 1
  preferredRoles?: string[]; workArrangements?: WorkArrangement[];
  preferredLocations?: string[]; minimumSalary?: number | null; salaryCurrency?: string | null;
}
interface ProfileDocumentInput extends ProfileBasicsInput {
  skills: SkillInput[]; experience: ExperienceInput[]; education: EducationInput[];
  projects: ProjectInput[]; preferences: PreferencesInput | null;
}

// Responses: each Input plus `id`, all optional fields present as value or null, arrays always present.
interface Profile {
  id: string; /* = the owner's user id */ name: string; headline: string | null; summary: string | null;
  email: string | null; location: string | null; links: string[]; verified: boolean;
  totalExperienceMonths: number;
  skills: Skill[]; experience: Experience[]; education: Education[]; projects: Project[];
  preferences: Preferences | null;
  createdAt: string; updatedAt: string;                  // ISO-8601
}
```

## Validation rules

All validation lives in `src/validation/profile.validation.ts`. These are pure functions called by `ProfileService`, so REST and gRPC get identical checks.

- **Clean-up before checking:**
  - Strings are trimmed.
  - Optional strings that end up empty become `null`.
  - List items are trimmed, and empty items are dropped.
- **Size limits:**
  - `name`: 1–200 characters. `headline` and `location`: up to 200. `summary`: up to 5000.
  - `email`: up to 254 characters, in `x@y.z` form.
  - `links`: up to 10, each up to 500 characters.
  - Skills: up to 100, name up to 100 characters.
  - Experience: up to 50 rows. `companyName` and `jobTitle` up to 200 characters.
  - Education: up to 20 rows. `institutionName`, `degree` and `fieldOfStudy` up to 200 characters.
  - Projects: up to 50. Name up to 200 characters. `tech` up to 30 items of up to 100 characters.
  - `bullets`: up to 20 items of up to 500 characters (experience and projects).
  - Preference lists: up to 20 items each.
- **Formats and ranges:**
  - `links` must be http or https URLs.
  - Dates must be real `YYYY-MM-DD` dates. `startDate` can't be in the future, and `endDate` must be on or after `startDate`.
  - If `isCurrent` is true, `endDate` must be null.
  - `gpa`: 0–4.
  - `year`: 4 digits.
  - `minimumSalary`: 0 or more.
  - `salaryCurrency`: 3 uppercase letters.
  - Values in the [Shared vocabulary](#shared-vocabulary) must be one of the listed values.
- **Duplicates:** skill names within one request are de-duplicated ignoring case. The first spelling wins.
- **Failures** throw a `ValidationError` carrying `details: { field, message }[]`. The `field` is a path, for example `experience[2].endDate`.

## Business rules (`ProfileService`)

- **Experience months.** `total_experience_months` is recalculated whenever experience is created, updated or deleted, and on `confirm`:
  - Each row with a `startDate` becomes the range `[startDate, isCurrent ? today : (endDate ?? startDate)]`.
  - Overlapping ranges are merged.
  - The result is `floor(totalDays / 30.4375)`.
- **Timestamps.** Every write to a profile or any of its child rows sets `candidate_profile.updated_at = now()`.
- **`verified`:**
  - `confirm` sets it to `true`.
  - `POST /me` creates the profile with `false`.
  - All other writes leave it as it is.
- **Transactions.** Writes that touch more than one row run in one transaction: `confirm`, experience writes (which also update the profile row), and `DELETE /me`.
- **Duplicate skills.** A Postgres unique violation on the skill index (`23505`) becomes `DUPLICATE_SKILL`.

## Code structure

This follows the existing layers; the scaffold's TODO numbers are resolved in place.

| File | Change |
|---|---|
| `src/types/profile.types.ts` | Domain types and inputs above |
| `src/validation/profile.validation.ts` | **New.** Pure validators |
| `src/utils/errors.ts` | Add `ValidationError` (400, with `details`), `UnauthenticatedError` (401), `NotFoundError` (404, with code), `ConflictError` (409, with code), `FileTooLargeError` (413), `UnsupportedFileTypeError` (415) |
| `src/middleware/error.middleware.ts` | Include `details`. Map malformed JSON to 400 and body-too-large to 413. Never leak internal errors |
| `src/middleware/identity.middleware.ts`, `cors.middleware.ts` | **New** |
| `src/repositories/profile.repository.ts` | The interface grows one method per operation. `PostgresProfileRepository` uses `pool` and a `withTransaction` helper. Rows are mapped to domain objects |
| `src/services/profile.service.ts` | One method per endpoint, plus `getProfileById` for gRPC |
| `src/controllers/profile.controller.ts`, `src/routes/profile.routes.ts` | All the routes above |
| `src/adapters/ai/*` | `ParsedResume = ProfileDocumentInput`. The placeholder returns fixed sample data |
| `src/config/env.ts` | Add `CORS_ORIGIN` |
| `proto/candidate-profile.proto`, `src/grpc/candidate-profile.grpc.ts` | See [gRPC](#grpc-getprofile) |
| `README.md`, `TODO.md`, `.env.example` | Update the API table and env vars. Mark finished TODOs |

## gRPC `GetProfile`

`GetProfile(candidate_id)` looks the profile up by `candidate_profile.id`:

- A `candidate_id` that isn't a UUID returns `INVALID_ARGUMENT`.
- An unknown ID returns `NOT_FOUND`.
- The proto drops the old `status` field (field 2 is marked `reserved`) and exposes the fields below.

```proto
message CandidateProfile {
  string candidate_id = 1;
  reserved 2, 3; reserved "status", "user_id";   // the profile id is the user id
  string name = 4;
  string headline = 5;
  string location = 6;
  int32 total_experience_months = 7;
  repeated Skill skills = 8;
  repeated WorkExperience experience = 9;
  repeated Education education = 10;
  repeated Project projects = 11;
  JobPreference preferences = 12;      // unset when none
  bool verified = 13;
  string updated_at = 14;              // ISO-8601
}
message Skill { string name = 1; string proficiency_level = 2; }
message WorkExperience { string company_name = 1; string job_title = 2; string start_date = 3; string end_date = 4; bool is_current = 5; repeated string bullets = 6; }
message Education { string institution_name = 1; string degree = 2; string field_of_study = 3; double gpa = 4; string year = 5; }
message Project { string name = 1; repeated string tech = 2; repeated string bullets = 3; }
message JobPreference { repeated string employment_types = 1; repeated string preferred_roles = 2; repeated string work_arrangements = 3; repeated string preferred_locations = 4; double minimum_salary = 5; string salary_currency = 6; }
```

## Errors

Every REST error uses the existing format: `{ "error": { "code": string, "message": string, "details"?: { field, message }[] } }`.

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `MALFORMED_JSON`, `EMPTY_FILE` |
| 401 | `UNAUTHENTICATED` |
| 404 | `PROFILE_NOT_FOUND`, `SKILL_NOT_FOUND`, `EXPERIENCE_NOT_FOUND`, `EDUCATION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `PREFERENCES_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `PROFILE_ALREADY_EXISTS`, `DUPLICATE_SKILL` |
| 413 | `FILE_TOO_LARGE` |
| 415 | `UNSUPPORTED_FILE_TYPE` |
| 500 | `INTERNAL_ERROR` (generic message only) |

gRPC status mapping: validation → `INVALID_ARGUMENT`, not found → `NOT_FOUND`, anything else → `INTERNAL`.

## Testing

Everything uses the built-in Node test runner (`npm test`), with no new dependencies.

- **Validation unit tests:** every rule above, including field paths in `details`.
- **Service unit tests,** run against `InMemoryProfileRepository` (`tests/fakes/`):
  - experience months (overlaps, current roles, missing dates)
  - `verified` handling
  - duplicate skills
  - not-found paths
  - confirm replacing everything
- **REST tests:** `createApp(...).listen(0)` plus `fetch`, with the service running on the in-memory repository. They cover each route's success and main error codes, CORS preflight, and 401 without `X-User-Id`.
- **gRPC test:** a server on port 0 and a `@grpc/grpc-js` client calling `GetProfile`, covering found, not found and bad ID.
- **Optional Postgres integration test:** runs only if `TEST_DATABASE_URL` is set (otherwise skipped). It covers the repository against a real database, including the case-insensitive skill index.
- **Always:** `npm run typecheck` and `npm run build` pass.

## Environment

| Variable | Default | New? |
|---|---|---|
| `REST_PORT` | `3001` | no |
| `GRPC_PORT` | `50051` | no |
| `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_SSL_CA_PATH` | — | no |
| `CORS_ORIGIN` | `http://localhost:3000` | **yes** |
