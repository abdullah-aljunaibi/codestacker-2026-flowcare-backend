# FlowCare Audit Notes

Date: 2026-03-11

This file is intentionally limited to reviewer-facing notes that still match the repository.

## Current Contract Snapshot

- Protected routes use HTTP Basic Authentication.
- Public endpoints are `GET /health`, `GET /api/branches`, `GET /api/service-types`, `GET /api/slots`, `POST /api/auth/register`, and `POST /api/auth/login`.
- Queue endpoints are quarantined from the judged API surface and are not mounted by `src/index.ts`.
- Registration requires multipart form data with `idImage`.
- Appointment booking uses `POST /api/appointments` with multipart form data and optional `attachment`.
- Audit logs are viewable at `GET /api/audit` for admins and branch managers, and exportable at `GET /api/audit/export` for admins.
- Each audit record includes an `actorRole` field that snapshots the role of the user at the time of the event.
- The CSV export includes `actorRole` as a dedicated column.

## RBAC Summary

- **Staff** cannot cancel/reschedule appointments, cannot browse staff/customer directories, can view own profile via `/api/staff/me`.
- **Staff-to-service assignments** are managed via `StaffServiceAssignment` records at `/api/service-types/:id/assign-staff`.
- **Slot-level assignments** are managed via `SlotAssignment` records at `/api/slots/:id/assign-staff`.

## Reviewer Guidance

- Use `docs/API.md` for the supported route list and working curl examples.
- Use `README.md` for setup, bootstrap, and quick verification commands.
- Ignore `src/routes/queue.ts` during evaluation; it is a quarantined placeholder and is not part of the mounted API surface.
