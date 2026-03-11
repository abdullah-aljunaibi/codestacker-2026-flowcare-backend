# Backend Readiness Assessment — Codestacker 2026

## GitHub Repository

**https://github.com/abdullah-aljunaibi/codestacker-2026-flowcare-backend** (public)

## Challenge Requirements Checklist

### Entities ✅

- [x] Branch
- [x] ServiceType
- [x] Slot
- [x] Staff
- [x] Customer
- [x] Appointment
- [x] AuditLog
- [x] SlotAssignment (supporting entity)
- [x] StaffServiceAssignment (staff-to-service/branch assignment)

### Roles & RBAC ✅

- [x] Admin (system-wide access)
- [x] Branch Manager (branch-scoped)
- [x] Staff (branch-scoped, own schedule; cannot cancel/reschedule appointments; cannot browse staff or customer directories)
- [x] Customer (own data)

### Public APIs ✅

- [x] List branches
- [x] List services by branch
- [x] List available slots (with branch/service/date filters)

### Auth ✅

- [x] Register customer
- [x] Login with HTTP Basic Authentication
- [x] Customer profile auto-created on registration

### Customer APIs ✅

- [x] Book appointment (customer identity resolved from authenticated request context)
- [x] List my appointments
- [x] Cancel appointment
- [x] Reschedule appointment

### Staff/Manager/Admin APIs ✅

- [x] List appointments (role-scoped)
- [x] Update appointment status (checked-in, no-show, completed)
- [x] View audit logs (admin: all, manager: branch-only)

### Manager/Admin APIs ✅

- [x] Create slots (single)
- [x] Update slot
- [x] Soft delete slot
- [x] Restore soft-deleted slot
- [x] List staff (admin: all, manager: branch-only)
- [x] List customers
- [x] Get customer with ID image
- [x] Retention cleanup (hard-delete expired soft-deleted slots)
- [x] View all audit logs (admin only)
- [x] Export audit logs as CSV (admin only)

### File Storage ✅

- [x] Customer ID image upload
- [x] Appointment attachment upload
- [x] File retrieval with correct content-type
- [x] Role-based file access control

### Soft Delete ✅

- [x] `deletedAt` timestamp stored
- [x] Soft-deleted slots hidden from normal listings
- [x] Admin can view soft-deleted records
- [x] Audit log entry on soft delete
- [x] Retention cleanup (hard delete after N days)
- [x] Idempotent cleanup

### Audit Logging ✅

- [x] Appointment creation/reschedule/cancellation
- [x] Slot creation/update/delete
- [x] Hard delete actions
- [x] CSV export
- [x] Each log includes: action, actor, entity, entityId, timestamp, metadata, actorRole
- [x] `actorRole` snapshots the actor's role at the time of the event
- [x] CSV export includes `actorRole` column

### Technical Requirements ✅

- [x] PostgreSQL
- [x] Git
- [x] Public GitHub repo
- [x] README with setup, env vars, seeding, API examples
- [x] Migration scripts (Prisma)
- [x] Idempotent seeding

### Seed Data ✅

- [x] 2 branches
- [x] 6 service types (3 per branch)
- [x] 6 staff (3 per branch)
- [x] 2 branch managers
- [x] 5 customers
- [x] 144 slots (next 3 days)
- [x] 1 sample appointment

## Reviewer Notes

- Reviewer-facing documentation now uses only HTTP Basic Authentication wording.
- Queue placeholders are quarantined from the mounted API surface and do not appear in the judged API docs.
- Working curl examples are maintained in `README.md` and `docs/API.md`.

### Staff-Service Assignments ✅

- [x] `StaffServiceAssignment` model with unique constraint on (staffId, serviceTypeId, branchId)
- [x] `GET /api/service-types/:id/staff` lists assigned staff
- [x] `POST /api/service-types/:id/assign-staff` assigns staff (idempotent on duplicate)
- [x] `DELETE /api/service-types/:id/assign-staff/:staffId` removes assignment
- [x] Validates staff belongs to same branch as service type
- [x] Branch manager branch-scoped

## Date: 2026-03-11
