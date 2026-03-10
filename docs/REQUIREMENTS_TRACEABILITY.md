# Reviewer Traceability Matrix

Date: 2026-03-10

| Requirement | Current repository evidence | Status |
| --- | --- | --- |
| Basic Authentication is the protected-route contract | `src/middleware/auth.ts`, `src/routes/auth.ts`, `README.md`, `docs/API.md` all describe or implement HTTP Basic Authentication | aligned |
| Public endpoints are limited and explicit | `GET /health`, `GET /api/branches`, `GET /api/service-types`, `GET /api/slots`, `POST /api/auth/register`, `POST /api/auth/login` | aligned |
| Customer registration includes inline ID image upload | `src/routes/auth.ts` uses multipart upload field `idImage` and stores the file during registration | aligned |
| Customers can book, cancel, reschedule, and view their own appointments | `src/routes/appointments.ts` implements list, create, patch, and delete with customer ownership checks | aligned |
| Staff and managers are branch-scoped | `src/middleware/auth.ts`, `src/routes/appointments.ts`, `src/routes/branches.ts`, `src/routes/service-types.ts`, `src/routes/slots.ts`, `src/routes/staff.ts` enforce branch context | aligned |
| Audit viewing/export exists | `src/routes/audit.ts` exposes `GET /api/audit` and `GET /api/audit/export` | aligned |
| Queue placeholders are not part of judged API docs | `docs/API.md` and `README.md` omit queue routes; `src/index.ts` does not mount `/api/queue` | aligned |

Use `docs/API.md` as the current route reference.
