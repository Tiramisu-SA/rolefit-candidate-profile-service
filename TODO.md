# Candidate Profile Service: Implementation Plan

Work through these in order. Each one is small enough to finish and check before you move on. Search the code for `TODO <n>` to find where each step goes.

After every step, `npm run typecheck` should still pass and `npm run dev` should still start.

---

## Phase 1: Infrastructure

### TODO 1: Validate environment configuration ✅ Done
**Files:** `src/config/env.ts`

Right now, missing or malformed variables fall back to defaults without any warning (`Number("abc")` becomes `NaN`, for example). Make the service **fail fast** on bad config:
- Decide which variables are required and which can have safe defaults.
- Check that the ports are valid port numbers.
- Throw one clear error that lists everything that is wrong.

**Done when:** starting with `REST_PORT=abc` stops immediately with a readable message.

### TODO 2: Configure the PostgreSQL (Supabase) connection ✅ Done
**Files:** `src/config/database.ts`, `src/server.ts`, `.env`

SSL and the connection string are already wired up. You still need to:
- Put your Supabase **Session pooler** connection string in `.env` (see `.env.example`).
- Set sensible `Pool` options (max connections, timeouts). Supabase limits connections per project, so keep `max` small.
- Add a listener for the pool's `error` event.
- Implement `checkDatabaseConnection()` so it runs a trivial query and logs success.
- Call it from `main()` in `server.ts`. Decide whether an unreachable DB should stop startup or only log a warning, and be ready to justify that choice.
- *(Recommended)* Download Supabase's CA certificate and set `DATABASE_SSL_CA_PATH`, so the server certificate is verified.

**Done when:** `npm run dev` logs a successful connection to Supabase, and a wrong password gives the behaviour you chose.

### TODO 3: Design the candidate profile schema ✅ Done

> Tables were created in the Supabase dashboard and recorded in `001_init.sql`, with fixes in `002_small_schema_fixes.sql`. The Supabase Data API is turned off, so the database is only reachable through this service. **Still open:** there is no draft/confirmed status column yet (needed by TODOs 6, 14 and 15).

**Files:** `db/migrations/001_init.sql`

Write the `CREATE TABLE` statement(s). Things to decide (don't try to model everything):
- **Identity:** what is the primary key, and how does `candidateId` relate to the user account that another service owns?
- **Personal/contact info:** which fields does a profile need?
- **Professional data:** skills, work experience, education. Should these be columns, separate tables, or `JSONB`? Weigh how the data will be queried against how simple the schema stays.
- **Lifecycle:** how do you store `draft` vs `confirmed`? Should you keep the raw resume text or the raw AI output?
- **Auditing:** `created_at` / `updated_at`.
- **Constraints:** `NOT NULL`, `UNIQUE`, `CHECK`.
- **Supabase specifics:** tables in the `public` schema are exposed through Supabase's auto-generated Data API. That API is a second way in, which breaks the "only this service accesses the data" rule. Decide how to close it (e.g. a dedicated schema, or enabling Row Level Security with no policies) and explain why.

Run the file with the Supabase **SQL Editor** or `psql "$DATABASE_URL" -f db/migrations/001_init.sql`. If you change the schema later, add a new numbered file instead of editing one that has already been applied.

**Done when:** the table shows up in the Supabase Table Editor, and you can explain each design choice.

### TODO 4: Model profile types in TypeScript
**Files:** `src/types/profile.types.ts`

- Add the fields from TODO 3 to `CandidateProfile` (use camelCase in TS and snake_case in SQL; the repository maps between them).
- Fill in `ConfirmProfileInput` and `UpdateProfileInput`. Decide which fields a candidate may change, and which are system-managed (ids, status, timestamps).
- Revisit `ProfileStatus` if your lifecycle needs more states.

**Done when:** types compile and match your schema.

---

## Phase 2: Data access

### TODO 5: `ProfileRepository.findByCandidateId()`
**Files:** `src/repositories/profile.repository.ts`

- `candidateId` in the API means `candidate_profile.id` (the primary key that the other tables reference with `candidate_id`), not `user_id`.
- A profile is spread over 5 tables. Decide how to load the child rows (skills, work experience, education, job preference): separate queries or JOINs?
- Write a **parameterized** query (`$1`), never string concatenation.
- Write a small row→domain mapping function (snake_case → camelCase). You will reuse it in TODOs 6 and 7.
- Return `null` when nothing is found. The repository does not decide whether "not found" is an error; the service does.

**Done when:** you can call it from a temporary script or a test and get a profile or `null`.

### TODO 6: `ProfileRepository.saveDraft()`
**Files:** `src/repositories/profile.repository.ts`

Store AI-extracted data as a `draft` profile. Decide what should happen when a draft (or a confirmed profile) already exists for this candidate: create another row, overwrite, or reject? Use `RETURNING` so you don't need a second query.

### TODO 7: `ProfileRepository.confirm()` and `update()`
**Files:** `src/repositories/profile.repository.ts`

- `confirm()` writes the reviewed data and sets the status to confirmed.
- `update()` changes **only the provided fields** and bumps `updated_at`. Consider how to build a partial UPDATE safely without SQL injection (column names cannot be parameters).
- Both should report "no such profile" somehow. Pick a convention (e.g. return `null`).

---

## Phase 3: Business layer and REST

### TODO 8: Domain errors and HTTP error mapping
**Files:** `src/utils/errors.ts`, `src/middleware/error.middleware.ts`

- Add error classes for the cases your service needs, at least "profile not found" and "invalid input", each with an HTTP status and error code.
- In the middleware, handle malformed JSON bodies (Express raises its own error for those) and make sure DB errors never leak SQL or stack traces to clients.

### TODO 9: `ProfileService.getProfile()`
**Files:** `src/services/profile.service.ts`

Use the repository, and throw your not-found error (TODO 8) when there's no profile. Also decide whether a **draft** profile should be returned to everyone, or only confirmed ones. Job Discovery also calls this method via gRPC.

**Done when:** `GET /api/profiles/<id>` returns 200 for an existing profile and 404 otherwise.

### TODO 10: Validate REST input in the controller
**Files:** `src/controllers/profile.controller.ts` (optionally a new helper in `src/utils/` or `src/middleware/`)

The controllers currently trust `req.body` with a type cast. Add validation for each route: required fields, types, empty strings, unknown fields. Throw your validation error from TODO 8. Hand-written checks are fine. A schema library such as zod is optional.

Keep **business rules** (e.g. "cannot update a draft") in the service. The controller only checks that the request is well-formed.

### TODO 11: `ProfileService.updateProfile()`
**Files:** `src/services/profile.service.ts`

Apply the candidate's changes. Think about the business rules: can a draft be updated with PUT, or only a confirmed profile? What happens with an empty update?

**Done when:** `PUT /api/profiles/<id>` updates the row and returns the updated profile.

---

## Phase 4: Resume import (AI Model Adapter)

### TODO 12: Define the AI adapter contract
**Files:** `src/adapters/ai/ai.types.ts`

Define `ParsedResume`: what should the AI extract? Remember the AI can get things wrong or miss fields. Which fields must be optional? Keep the type free of any provider-specific shape.

### TODO 13: Fake `parseResume()` for development
**Files:** `src/adapters/ai/ai.adapter.ts`

Make `PlaceholderAIModelAdapter.parseResume()` return a fake but realistic `ParsedResume`, so you can build the import flow with **no** real AI call. It's up to you whether it returns fixed data or derives something simple from the input.

### TODO 14: `ProfileService.importResume()`
**Files:** `src/services/profile.service.ts`

Orchestrate the flow: resume text → `aiModelAdapter.parseResume()` → `profileRepository.saveDraft()` → return the draft. Consider:
- What if the AI adapter fails or returns unusable data? Which error and status code should the client get?
- Should the service check or clean up the AI output before saving it?
- *(Optional)* Accept a PDF/DOCX upload instead of plain text. You'd need an upload middleware (e.g. multer) and a text-extraction step before calling the adapter.

**Done when:** `POST /api/profiles/import-resume` creates a draft and returns it.

### TODO 15: `ProfileService.confirmExtractedProfile()`
**Files:** `src/services/profile.service.ts`

The candidate reviews the draft and sends back the corrected data. Rules to consider: a draft must exist; what if it's already confirmed? Should confirming validate that required fields are now present?

**Done when:** import → confirm → get works end-to-end over REST.

---

## Phase 5: Internal gRPC API

### TODO 16: Complete the gRPC contract
**Files:** `proto/candidate-profile.proto`, `src/grpc/candidate-profile.grpc.ts` (`CandidateProfileMessage`)

Add the fields that **other services** need. Think about Job Discovery: what does it need for matching? Don't expose everything by default. Use `repeated` and nested messages where they fit. Once field numbers are published, never renumber or reuse them.

Keep the TypeScript `CandidateProfileMessage` interface in sync.

### TODO 17: Implement the gRPC `GetProfile` handler
**Files:** `src/grpc/candidate-profile.grpc.ts`

The call into `profileService.getProfile()` is already wired. You still need to:
- Validate `candidate_id` (an empty string is the proto3 default).
- Implement `toProtoProfile()` (domain → proto; watch out for `Date` values, which proto3 has no plain type for).
- Map your domain errors to proper gRPC status codes in `toGrpcError()`.

Do **not** add any business logic or SQL here. If you need a rule, it belongs in `ProfileService`.

### TODO 18: Test the gRPC API manually
Call `GetProfile` the way Job Discovery would: with [grpcurl](https://github.com/fullstorydev/grpcurl) (`-import-path proto -proto candidate-profile.proto -plaintext`), a GUI client such as Postman, or a small Node client script. Check a found profile, a missing profile, and an empty id.

---

## Phase 6: Quality

### TODO 19: Automated tests
**Files:** `tests/`

`tests/health.test.ts` shows the pattern (Node's built-in test runner, run with `npm test`). Add:
- **Service unit tests** using an in-memory fake `ProfileRepository` and a fake `AIModelAdapter`. The interfaces exist so you can do this.
- **REST tests** for status codes (200/201/400/404).
- *(Optional)* A gRPC test that starts the server on port 0 and calls it with a client.

### TODO 20 (later / optional): Real AI provider adapter
**Files:** new class in `src/adapters/ai/`, `src/config/env.ts`, `src/server.ts`

Create a second `AIModelAdapter` implementation that calls a real LLM provider. Keep the API key in env config, add timeouts, and validate the model's output before returning a `ParsedResume`. Switch implementations in `server.ts` only. `ProfileService` should not need any change, which shows the adapter design is working.
