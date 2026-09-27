# Candidate Profile REST CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (Native). This plan is deliberately minimal, as the user asked: the spec holds the contracts. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Candidate Profile Service against the ER diagram: REST CRUD for every table, import and confirm, and gRPC `GetProfile`.
**Architecture:** Existing layers: routes → controller → `ProfileService` → `ProfileRepository` (pg). Validators are pure functions, called by the service. Identity comes from the `X-User-Id` middleware.
**Tech Stack:** Node 24, TypeScript, Express 5, pg, @grpc/grpc-js, node:test via tsx.
**Spec:** `docs/superpowers/specs/2026-09-27-profile-rest-crud-design.md`

## Global Constraints
- No new runtime dependencies (CORS is hand-written). Test with `node:test` only.
- Error format: `{ error: { code, message, details? } }`. The codes, statuses and limits are exactly those in the spec.
- Enum strings: `BASIC|INTERMEDIATE|ADVANCED`, `FULL_TIME|PART_TIME|INTERNSHIP|CONTRACT`, `ONSITE|HYBRID|REMOTE`.
- Never write `.env` files. Tell the user about new env vars (`CORS_ORIGIN`).

## Review Focus
- A PUT or DELETE on a child `:id` belonging to **another** user must return 404, never touch their row. Covered by a REST test in Task 4.
- `isCurrent: true` with an `endDate` → 400 at `experience[i].endDate` (Task 2).
- Skill names that differ only in case, on POST and on PUT to a different row → 409 `DUPLICATE_SKILL` (Task 3 fake and Task 5 pg).
- A malformed JSON body → 400 `MALFORMED_JSON`, not 500 (Task 4).
- `confirm` on an existing profile replaces the children and doesn't duplicate them (Task 3).

---

### Task 1: Migration 003 + setup
**Files:** Create `db/migrations/003_match_er_diagram.sql`.
- [ ] Run `npm install`.
- [ ] Write 003, per the spec's migration section. It's one `BEGIN/COMMIT`, and every step is guarded (`IF EXISTS` / `IF NOT EXISTS`, or `DO $$ … $$` blocks that check `information_schema`), so the 001, 001+002 and diagram states all end at the diagram. The check query goes at the top, commented out.
- [ ] Commit: `feat(db): add migration 003 matching ER diagram`.

### Task 2: Types, errors, validation
**Files:** Modify `src/types/profile.types.ts` and `src/utils/errors.ts`. Create `src/validation/profile.validation.ts` and `tests/validation.test.ts`.
**Produces:**
- Types: `Profile`, `Skill`, `Experience`, `Education`, `Project`, `Preferences`, and the `*Input` types from the spec. `ProfileDocumentInput`.
- Validators: `validateBasics(body, {partial})`, `validateSkill`, `validateExperience`, `validateEducation`, `validateProject`, `validatePreferences`, `validateDocument`. Each returns the cleaned input or throws `ValidationError(details)`.
- Errors: `ValidationError`, `UnauthenticatedError`, `NotFoundError(code, msg)`, `ConflictError(code, msg)`, `FileTooLargeError`, `UnsupportedFileTypeError`, `MalformedJsonError`, `EmptyFileError`.
- [ ] Write failing tests:
  - trimming, and empty optional strings becoming `null`
  - each limit and format rule from the spec
  - `isCurrent` with an `endDate`
  - `endDate < startDate`
  - a future `startDate`
  - `gpa` of 5
  - `year` of `'26'`
  - a bad enum value
  - a bad URL in `links`
  - skills de-duplicated ignoring case (first spelling wins)
  - nested field paths such as `experience[1].endDate`
- [ ] Implement until green: `npm test`.
- [ ] Commit.

### Task 3: Service + in-memory repository
**Files:** Modify `src/repositories/profile.repository.ts` (interface only here) and `src/services/profile.service.ts`. Create `tests/fakes/in-memory-profile.repository.ts`, `tests/profile.service.test.ts`, and `src/services/experience-months.ts` (a pure function).
**Produces:**
- The `ProfileRepository` interface:
  - `findByUserId`, `findById`, `create(userId, basics)`, `updateBasics`, `deleteByUserId`
  - `listChildren(kind, profileId)`, `insertChild`, `updateChild(kind, profileId, id, input)` → row or null, `deleteChild` → boolean
  - `upsertPreferences`, `deletePreferences` → boolean
  - `replaceDocument(userId, doc, verified)`
  - `setExperienceMonths(profileId, months)`
  - `kind` is `'skills'|'experience'|'education'|'projects'`
  - The repository throws `ConflictError('DUPLICATE_SKILL')` on a duplicate skill.
- `computeExperienceMonths(rows, today)`.
- `ProfileService` has one method per endpoint, each taking `userId` first, plus `getProfileById(id)`.
- [ ] Failing tests:
  - experience months: an overlap is merged, a current role runs to `today`, no `startDate` counts as 0
  - `POST` twice → `PROFILE_ALREADY_EXISTS`
  - every child call without a profile → `PROFILE_NOT_FOUND`
  - `verified`: false on create, true after confirm, unchanged after a patch
  - confirm replaces the children
  - an experience write recalculates the months
- [ ] Implement until green, then commit.

### Task 4: Postgres repository, REST layer, identity, CORS
**Files:**
- Modify: `src/repositories/profile.repository.ts` (`PostgresProfileRepository` + `withTransaction`), `src/controllers/profile.controller.ts`, `src/routes/profile.routes.ts`, `src/app.ts`, `src/middleware/error.middleware.ts`, `src/config/env.ts` (`corsOrigin`), `src/server.ts`.
- Create: `src/middleware/identity.middleware.ts`, `src/middleware/cors.middleware.ts`, `tests/rest.test.ts`.
- Remove: the `NotImplementedError` uses, and the class if nothing uses it any more.

**Notes:**
- In pg, child ownership goes in the WHERE clause: `WHERE id = $1 AND candidate_id = $2`. An `:id` that isn't a UUID returns not-found without querying.
- Map pg error `23505` on the skill index to `DUPLICATE_SKILL`.
- Ordering follows the spec.
- `import-resume` uses `express.raw({ type: [pdf, msword, docx], limit: '5mb' })` on that route. The error middleware maps `entity.too.large` → 413 and `entity.parse.failed` → 400 `MALFORMED_JSON`. A wrong content type → 415.

**Steps:**
- [ ] Failing REST tests (the app is built with the in-memory repository):
  - 401 without `X-User-Id`
  - the OPTIONS preflight gets 204 and the CORS headers
  - the full profile lifecycle: `POST /me` → GET → PATCH → DELETE
  - create, read, update and delete for each child collection
  - another user's child `:id` → 404
  - the preferences create-or-update, GET and DELETE
  - import: 415, 413, and 200 with a `fileName`
  - confirm → `verified: true`
  - malformed JSON → 400 `MALFORMED_JSON`
- [ ] Implement until green. The placeholder AI adapter returns fixed sample data (the Pimchanok sample from the frontend spec: skills, one experience, two projects, one education, preferences).
- [ ] Commit.

### Task 5: gRPC GetProfile + pg integration test + docs
**Files:** Modify `proto/candidate-profile.proto` and `src/grpc/candidate-profile.grpc.ts`. Create `tests/grpc.test.ts` and `tests/pg.integration.test.ts`. Update `README.md`, `TODO.md`, `.env.example`.
- [ ] Failing gRPC test, with a server on port 0 and a real client:
  - found → mapped message
  - an unknown UUID → `NOT_FOUND`
  - `"abc"` → `INVALID_ARGUMENT`
- [ ] Implement the proto and mapping from the spec.
- [ ] The pg integration test runs only with `TEST_DATABASE_URL`. It covers create → child CRUD → duplicate skill 409 → delete.
- [ ] Run `npm test`, `npm run typecheck` and `npm run build`. Update the docs, then commit.
