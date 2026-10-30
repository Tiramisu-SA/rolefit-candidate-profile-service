# RoleFit – Candidate Profile Service

Owns candidate profile data for RoleFit. It turns an uploaded resume into a profile (with help from an AI model), lets the candidate confirm and edit it, and serves it to the web frontend (REST) and to other RoleFit services (gRPC).

> **Status:** implemented: REST CRUD for every profile table, resume import/confirm (real PDF/Word parsing, by an AI model of your choice or a basic library parser), and gRPC `GetProfile`. Design: [docs/superpowers/specs/2026-09-27-profile-rest-crud-design.md](docs/superpowers/specs/2026-09-27-profile-rest-crud-design.md).

## Quick start

```bash
npm install            # install dependencies
cp .env.example .env   # or .env.local (loaded first); paste your Supabase connection string into DATABASE_URL
npm run dev            # start REST + gRPC with auto-reload (tsx watch)
```

| Script              | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Run from TypeScript sources with auto-reload  |
| `npm run build`     | Compile to `dist/`                            |
| `npm start`         | Run the compiled build                        |
| `npm run typecheck` | Type-check without emitting                   |
| `npm test`          | Run tests in `tests/` (Node test runner)      |

### Ports

| API  | Default | Env var     | Consumers                                   |
| ---- | ------- | ----------- | ------------------------------------------- |
| REST | `3001`  | `REST_PORT` | Web frontend (public)                        |
| gRPC | `50051` | `GRPC_PORT` | Other RoleFit services, e.g. Job Discovery (internal) |

### Database (Supabase)

The database is PostgreSQL hosted on **Supabase**. This service connects with the `pg` driver using the connection string from the Supabase dashboard (**Connect** button). `supabase-js` verifies Auth access tokens only; profile data is still accessed through this service's repository and PostgreSQL connection.

- Use the **Session pooler** string (port 5432). It works over IPv4, including from Docker. The direct connection is IPv6-only unless you have the IPv4 add-on.
- SSL is on by default (`DATABASE_SSL=true`). To fully verify the certificate, download Supabase's CA cert and set `DATABASE_SSL_CA_PATH`.
- Apply the schema in `db/migrations/` in order (001, 002, 003) with the Supabase **SQL Editor** or `psql "$DATABASE_URL" -f <file>`. `003_match_er_diagram.sql` is safe to re-run and brings any earlier state to the current ER diagram.

The server starts even if the database is unreachable, because `pg.Pool` connects lazily.

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the Supabase project settings. The service uses them to verify REST bearer tokens. Do not use a service role key here.

```bash
docker compose up --build   # run this service in Docker (reads .env)
```

### Resume parsing (AI provider)

An uploaded resume's text is read with `pdf-parse` (PDF) or `word-extractor` (.doc and .docx). The text then goes to the parser chosen with `AI_PROVIDER`:

- **Not set (or `none`):** the basic library parser reads it by its headings (Summary, Skills, Experience, Education, Projects). It needs no key, but the results are rough.
- **Set:** the AI model reads it. If the call fails (timeout, rate limit, unusable reply), the basic parser takes over, so an upload still works. The log says which parser handled each upload.

Add these to `.env` or `.env.local`:

| Variable | Needed | Meaning |
| -------- | ------ | ------- |
| `AI_PROVIDER` | no | `gemini`, `groq`, `openrouter`, `ollama`, `claude`, `openai-compatible`, or empty for none |
| `AI_MODEL` | yes (default `claude-opus-5-5` for `claude`) | Model id from the provider's model list |
| `AI_API_KEY` | yes for gemini, groq and openrouter | The provider's API key. For `claude` it may be left empty if `ANTHROPIC_API_KEY` is set |
| `AI_BASE_URL` | only for `openai-compatible` | API address; overrides the preset for the others |
| `AI_TIMEOUT_MS` | no (default `60000`) | How long to wait for the model before falling back |

Example (Gemini's free tier; check the current model id in Google AI Studio):

```bash
AI_PROVIDER=gemini
AI_MODEL=<gemini model id>
AI_API_KEY=<key from aistudio.google.com>
```

Every provider except Claude is called through the OpenAI-style `/chat/completions` API, so switching providers only means changing these variables. Keys are read from the environment only. Never commit them.

A bad combination (for example `AI_PROVIDER=groq` without `AI_MODEL`) stops startup with a message listing what is missing. A file with no text in it (a scan) gets `422 RESUME_UNREADABLE`.

## Architecture

```
 Web frontend                         Job Discovery Service (and others)
      │ REST/JSON :3001                        │ gRPC :50051
      ▼                                        ▼
 routes → ProfileController           candidate-profile.grpc.ts (handlers)
      │                                        │
      └──────────────┐          ┌──────────────┘
                     ▼          ▼
                  ProfileService          ← all business logic, shared by REST and gRPC
                   │            │
                   ▼            ▼
        ProfileRepository   AIModelAdapter.parseResume()
                   │            │
                   ▼            ▼
        Supabase Postgres   AI provider (AI_PROVIDER), or the basic parser
         (owned by this service only)
```

Rules this design follows:

- **Data ownership.** Only this service's `ProfileRepository` touches the candidate-profile database. Other services use the gRPC API. They never connect to PostgreSQL directly, and they never use the Supabase Data API either.
- **One business layer.** REST controllers and gRPC handlers are thin adapters. They translate protocol input/output and errors, then call the **same** `ProfileService` instance. Business rules are never duplicated.
- **Ports and adapters.** `ProfileService` depends on the `ProfileRepository` and `AIModelAdapter` *interfaces*, not on pg or a specific AI SDK. Concrete classes are wired together in one place, `src/server.ts` (the composition root).
- **AI Model Adapter is a module, not a microservice.** It lives in `src/adapters/ai/`. `server.ts` picks the implementation from `AI_PROVIDER`; `ProfileService` never knows which provider (if any) is used.

### REST API

Every `/api/profiles` route needs `Authorization: Bearer <access-token>`. Supabase verifies the token and the service takes the profile owner id from its signed `sub` claim; caller-supplied identity headers are ignored. A profile's `id` is its owner's user id (there is no `user_id` column). CORS allows the origin in `CORS_ORIGIN` (default `http://localhost:3000`) and permits the `Authorization` header.

| Method | Path | Result |
| ------ | ---- | ------ |
| GET | `/health` | health check |
| POST | `/api/profiles/me` | create profile (201, 409 if it exists) |
| GET / PATCH / DELETE | `/api/profiles/me` | read (with all sections) / update basics / delete everything |
| GET / POST | `/api/profiles/me/{skills,experience,education,projects}` | list / add a row |
| PUT / DELETE | `/api/profiles/me/{skills,experience,education,projects}/:id` | replace / delete one row |
| GET / PUT / DELETE | `/api/profiles/me/preferences` | read / create-or-update / delete |
| POST | `/api/profiles/me/import-resume` | raw PDF/DOC/DOCX body (≤ 5 MB), `X-File-Name` header → extracted profile, not saved |
| POST | `/api/profiles/me/confirm` | save a whole reviewed profile, `verified = true` |

Errors are returned as `{ "error": { "code": "...", "message": "...", "details"?: [{ "field", "message" }] } }`. Codes and body shapes are listed in the design spec.

### gRPC API

Defined in [proto/candidate-profile.proto](proto/candidate-profile.proto):

```proto
service CandidateProfileService {
  rpc GetProfile (GetProfileRequest) returns (GetProfileResponse);
}
```

The proto is loaded at runtime with `@grpc/proto-loader` (`keepCase: true`, so fields stay snake_case). Other services should use a copy of this `.proto` file as their contract.

## Project structure: where to implement each part

| File | Role | TODOs |
| ---- | ---- | ----- |
| `src/config/env.ts` | Loads and validates environment variables | 1 |
| `src/config/database.ts` | PostgreSQL pool and startup connection check | 2 |
| `db/migrations/001_init.sql` | Database schema (run in the Supabase SQL Editor) | 3 |
| `src/types/profile.types.ts` | Domain types and operation inputs | 4 |
| `src/repositories/profile.repository.ts` | SQL data access (only DB access in RoleFit) | 5, 6, 7 |
| `src/utils/errors.ts`, `src/middleware/error.middleware.ts` | Domain errors and their HTTP mapping | 8 |
| `src/services/profile.service.ts` | Business logic shared by REST and gRPC | 9, 11, 14, 15 |
| `src/controllers/profile.controller.ts` | REST input validation and responses | 10 |
| `src/adapters/ai/ai.types.ts`, `ai.adapter.ts` | AI Model Adapter contract | 12 |
| `src/adapters/ai/resume-text.ts`, `repair-document.ts` | Text extraction from PDF/Word; fixing parser output so it validates | 20 |
| `src/adapters/ai/basic-resume.adapter.ts` | Library-only parser (no AI), also the fallback | 20 |
| `src/adapters/ai/llm-resume.adapter.ts`, `fallback-resume.adapter.ts`, `clients/` | AI parser, the fallback switch, one client per provider API | 20 |
| `src/config/ai-config.ts` | `AI_*` variables and provider presets | 20 |
| `proto/candidate-profile.proto` | Internal gRPC contract | 16 |
| `src/grpc/candidate-profile.grpc.ts` | gRPC handlers and error/status mapping | 17 |
| `src/grpc/grpc.server.ts` | gRPC server bootstrap (already done) | none |
| `src/app.ts`, `src/routes/profile.routes.ts` | Express app and route wiring (already done) | none |
| `src/server.ts` | Composition root; starts REST + gRPC | 2 |
| `tests/` | Automated tests | 18, 19 |

Search the code for `TODO <n>` to find the exact spot for each step.
