# RoleFit – Candidate Profile Service

Owns candidate profile data for RoleFit. It turns an uploaded resume into a profile (with help from an AI model), lets the candidate confirm and edit it, and serves it to the web frontend (REST) and to other RoleFit services (gRPC).

> **Status:** scaffold only. Every business operation throws `NotImplementedError`, so the REST API returns **501** and gRPC returns **UNIMPLEMENTED**. See [TODO.md](TODO.md) for the implementation plan.

## Quick start

```bash
npm install            # install dependencies
cp .env.example .env   # then paste your Supabase connection string into DATABASE_URL
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

The database is PostgreSQL hosted on **Supabase**. This service connects with the `pg` driver using the connection string from the Supabase dashboard (**Connect** button). It does not use `supabase-js`.

- Use the **Session pooler** string (port 5432). It works over IPv4, including from Docker. The direct connection is IPv6-only unless you have the IPv4 add-on.
- SSL is on by default (`DATABASE_SSL=true`). To fully verify the certificate, download Supabase's CA cert and set `DATABASE_SSL_CA_PATH`.
- Apply the schema in `db/migrations/` with the Supabase **SQL Editor** or `psql "$DATABASE_URL" -f db/migrations/001_init.sql`.

The server starts even if the database is unreachable, because `pg.Pool` connects lazily.

```bash
docker compose up --build   # run this service in Docker (reads .env)
```

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
        Supabase Postgres   external AI/LLM provider (not connected yet)
         (owned by this service only)
```

Rules this design follows:

- **Data ownership.** Only this service's `ProfileRepository` touches the candidate-profile database. Other services use the gRPC API. They never connect to PostgreSQL directly, and they never use the Supabase Data API either.
- **One business layer.** REST controllers and gRPC handlers are thin adapters. They translate protocol input/output and errors, then call the **same** `ProfileService` instance. Business rules are never duplicated.
- **Ports and adapters.** `ProfileService` depends on the `ProfileRepository` and `AIModelAdapter` *interfaces*, not on pg or a specific AI SDK. Concrete classes are wired together in one place, `src/server.ts` (the composition root).
- **AI Model Adapter is a module, not a microservice.** It lives in `src/adapters/ai/` and will eventually call an external LLM provider.

### REST API

| Method | Path                           | Service operation           |
| ------ | ------------------------------ | --------------------------- |
| GET    | `/health`                      | none (health check)         |
| POST   | `/api/profiles`                | `createProfile()` (at registration, returns the generated id) |
| POST   | `/api/profiles/import-resume`  | `importResume()`            |
| POST   | `/api/profiles/:candidateId/confirm` | `confirmExtractedProfile()` |
| PUT    | `/api/profiles/:candidateId`   | `updateProfile()`           |
| GET    | `/api/profiles/:candidateId`   | `getProfile()`              |
| DELETE | `/api/profiles/:candidateId/skills/:skillName` | `deleteSkill()` (204 No Content) |

Errors are returned as `{ "error": { "code": "...", "message": "..." } }`.

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
| `src/repositories/profile.repository.ts` | SQL data access (only DB access in RoleFit) | 5, 6, 6b, 7 |
| `src/utils/errors.ts`, `src/middleware/error.middleware.ts` | Domain errors and their HTTP mapping | 8 |
| `src/services/profile.service.ts` | Business logic shared by REST and gRPC | 9, 11, 11b, 14, 15 |
| `src/controllers/profile.controller.ts` | REST input validation and responses | 10 |
| `src/adapters/ai/ai.types.ts`, `ai.adapter.ts` | AI Model Adapter contract and implementations | 12, 13, 20 |
| `proto/candidate-profile.proto` | Internal gRPC contract | 16 |
| `src/grpc/candidate-profile.grpc.ts` | gRPC handlers and error/status mapping | 17 |
| `src/grpc/grpc.server.ts` | gRPC server bootstrap (already done) | none |
| `src/app.ts`, `src/routes/profile.routes.ts` | Express app and route wiring (already done) | none |
| `src/server.ts` | Composition root; starts REST + gRPC | 2 |
| `tests/` | Automated tests | 18, 19 |

Search the code for `TODO <n>` to find the exact spot for each step.
