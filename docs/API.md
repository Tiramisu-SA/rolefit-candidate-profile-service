# Candidate Profile API

For the frontend team: how to connect the RoleFit web frontend to the Candidate Profile Service.

**Base URL:** `http://localhost:3001/api/profiles`. All requests and responses are JSON (`Content-Type: application/json`).

## Profile object

Every endpoint that returns a profile returns the same shape as the frontend's `CandidateProfile` type (`src/lib/types.ts`), plus `createdAt` and `updatedAt`.

- `initials` and `completeness` are calculated by the server; don't send them.
- Dates are `'YYYY-MM-DD'` strings.
- `preferences.minSalary` is a number.

## Errors

Every error has the same shape. Show `message` to the user.

```json
{ "error": { "code": "NOT_FOUND", "message": "Profile … not found" } }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input (bad ID, missing field, broken JSON) |
| 404 | Profile or skill not found |
| 500 | Server problem |
| 501 | Feature not built yet |

## Endpoints

| # | Method and path | Body | Success | Used by |
|---|---|---|---|---|
| 1 | `POST /api/profiles` | `{ "name": "…", "email": "…" }` | **201** + the new profile. **Save `id`**; it's the `candidateId` for every other call. | Register page |
| 2 | `GET /api/profiles/:candidateId` | none | **200** + profile | Profile page, dashboard, jobs |
| 3 | `PUT /api/profiles/:candidateId` | Only the fields that changed, e.g. `{ "headline": "…" }` | **200** + updated profile | Profile "Edit" → Save |
| 4 | `POST /api/profiles/:candidateId/confirm` | `{ "profile": { …the full reviewed profile… } }` | **200** + profile with `verified: true` | Resume "Confirm and save" |
| 5 | `DELETE /api/profiles/:candidateId/skills/:skillName` | none | **204**, empty body | ✕ on a skill chip |
| 6 | `POST /api/profiles/import-resume` | a file | **501**, not built yet | Keep using the mock |

## Details

- **Lists in PUT and confirm replace the whole list.** To remove an experience, send the list without it. Sending `[]` clears the list.
- **Education items:** send each item's `id` back, as received from GET, so the server keeps that row's extra data. New items may use any temporary ID like `'edu-1'`.
- **Skill names in URLs:** encode them with `encodeURIComponent(skillName)`, so `C++` still works in the URL. Matching is case-insensitive.
- **Candidate ID:** replace the hard-coded `CURRENT_CANDIDATE_ID = "cand-1"` with the `id` returned by endpoint 1.
- **Registration:** there's no login service yet. Call endpoint 1 after `signIn(...)` in the register page, and keep the returned `id`, e.g. in the session.
- **CORS:** the API accepts browser requests from `http://localhost:3000` (set with `CORS_ORIGIN` in the service's `.env`).
