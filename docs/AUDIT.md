# FlowCare Backend Current-State Audit

Date: March 10, 2026
Scope: `src/` and `prisma/` against the FlowCare challenge contract in `~/.openclaw/workspace/knowledge/flowcare-master-prompt.md`

## Executive Assessment

Current state: **PARTIAL / non-compliant for several hard requirements**

Highest-risk violations:

1. **Authentication contract is wrong**. The codebase is built around JWT bearer tokens, but the challenge requires Basic Authentication. See [src/middleware/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/auth.ts#L18) and [src/routes/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/auth.ts#L74).
2. **Seed/bootstrap contract is wrong**. Seeding is manual, destructive, hard-coded, and not startup-driven. The challenge requires idempotent startup import from the provided JSON file. See [prisma/seed.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/seed.ts#L19) and [src/index.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/index.ts#L82).
3. **Registration/file contract is wrong**. Customer ID upload is handled by a separate upload endpoint instead of inline during registration. See [src/routes/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/auth.ts#L10) and [src/routes/uploads.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/uploads.ts#L202).
4. **Retention configuration contract is wrong**. Retention days are passed as a query parameter instead of being persisted in the database and managed by admins. See [src/routes/slots.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/slots.ts#L242) and [prisma/schema.prisma](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/schema.prisma#L15).
5. **Audit coverage is incomplete**. Audit writes exist for some slot, appointment, staff, and file events, but not for all required sensitive actions, and branch scoping is not populated consistently. See [src/utils/audit-logger.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/utils/audit-logger.ts#L31) and [prisma/schema.prisma](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/schema.prisma#L213).

## Route-By-Route Assessment

### `src/routes/auth.ts`

Endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`

Challenge requires:

- Public registration that includes required customer fields and **ID image upload during registration**
- Login/authentication that satisfies the **Basic Auth** contract
- Default admin existence independent of manual seeding

Current behavior:

- `register` accepts JSON only, creates a `User`, auto-creates a `Customer` with generated placeholder `idNumber` and fixed DOB, and returns a JWT token. See [src/routes/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/auth.ts#L11).
- `login` validates email/password and returns a JWT token. See [src/routes/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/auth.ts#L99).

Gap analysis:

- **FAIL / CRITICAL**: Uses JWT issuance instead of Basic Auth.
- **FAIL / CRITICAL**: Registration does not accept inline file upload for customer ID.
- **FAIL / HIGH**: Registration schema omits required customer fields from the challenge flow and fabricates `idNumber` / `dateOfBirth`.
- **FAIL / HIGH**: `role` can be supplied by the caller during registration, which is broader than the expected customer-facing registration contract. See [src/types/index.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/types/index.ts#L6).
- **PARTIAL**: Public auth endpoints exist, but they implement the wrong auth mechanism.

### `src/routes/appointments.ts`

Endpoints:

- `GET /api/appointments`
- `POST /api/appointments`
- `GET /api/appointments/:id`
- `PATCH /api/appointments/:id`
- `DELETE /api/appointments/:id`

Challenge requires:

- Authenticated customers can book, cancel, reschedule, and view their own appointments
- Staff can view assigned schedule and update status
- Managers have branch-scoped visibility
- Attachments, if supported, must have permissioned retrieval

Current behavior:

- Auth is enforced via JWT middleware for the whole router. See [src/routes/appointments.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/appointments.ts#L10).
- `POST` books an appointment and increments slot `bookedCount`. See [src/routes/appointments.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/appointments.ts#L137).
- `PATCH` updates appointment status and timestamps. See [src/routes/appointments.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/appointments.ts#L426).
- `DELETE` hard-deletes the appointment after decrementing slot count. See [src/routes/appointments.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/appointments.ts#L575).

Gap analysis:

- **FAIL / CRITICAL**: Protected by JWT, not Basic Auth.
- **FAIL / HIGH**: No dedicated reschedule flow; `PATCH` cannot change `slotId`, so required reschedule behavior is missing.
- **FAIL / HIGH**: `DELETE` permanently removes appointments instead of preserving a cancellable record and audit trail.
- **FAIL / HIGH**: Booking does not validate that `branchId` matches the selected slot’s branch, so inconsistent branch data can be written. See [src/routes/appointments.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/appointments.ts#L190).
- **FAIL / HIGH**: No protection against duplicate customer booking of the same slot beyond `bookedCount`; there is no uniqueness rule or explicit duplicate check.
- **PARTIAL**: Ownership and branch scoping are present, but staff schedule is indirect rather than a clear assigned-schedule endpoint.

### `src/routes/audit.ts`

Endpoints:

- `GET /api/audit`
- `GET /api/audit/export`

Challenge requires:

- Admin can view/export all audit logs
- Manager can view branch-only audit logs
- Audit logs must capture required sensitive actions with required fields

Current behavior:

- Admin can list all logs and export CSV. See [src/routes/audit.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/audit.ts#L12) and [src/routes/audit.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/audit.ts#L121).
- Branch managers are filtered to `branchId`. See [src/routes/audit.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/audit.ts#L57).

Gap analysis:

- **PARTIAL / HIGH**: Route surface matches the challenge, but underlying audit rows often have no `branchId` because `logAudit()` does not persist branch context unless each caller provides it explicitly. See [src/utils/audit-logger.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/utils/audit-logger.ts#L40).
- **FAIL / HIGH**: Missing coverage for several required sensitive actions, including login, registration, branch/service management, and retention configuration changes.
- **FAIL / MEDIUM**: CSV export is system-wide for admin only, which is correct, but there is no manager-specific export if the challenge expects branch-level export as part of audit reviewer UX.

### `src/routes/branches.ts`

Endpoints:

- `GET /api/branches`
- `POST /api/branches`
- `GET /api/branches/:id`
- `PATCH /api/branches/:id`
- `DELETE /api/branches/:id`

Challenge requires:

- Public branch listing endpoint
- Admin manages all branches
- Manager branch scope only

Current behavior:

- `GET /api/branches` is public because no auth middleware is attached. See [src/routes/branches.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/branches.ts#L14).
- Branch CRUD exists for admins/managers. See [src/routes/branches.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/branches.ts#L68).

Gap analysis:

- **PARTIAL / MEDIUM**: Public listing exists and aligns with the contract.
- **FAIL / HIGH**: Public branch detail is not available because `GET /:id` requires auth, which is stricter than the public-discovery contract if detailed branch lookup is expected.
- **FAIL / MEDIUM**: Delete is hard delete; challenge emphasis is on branch-safe operations and reviewer reproducibility, so destructive deletes are risky.
- **FAIL / MEDIUM**: No audit logging for branch create/update/delete.

### `src/routes/customers.ts`

Endpoints:

- `GET /api/customers`
- `POST /api/customers`
- `GET /api/customers/:id`
- `PATCH /api/customers/:id`

Challenge requires:

- Customer registration path with required ID image upload
- Customer can access own profile/history
- Customer ID retrieval must be admin-only

Current behavior:

- Router is JWT-protected. See [src/routes/customers.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/customers.ts#L9).
- CRUD-like customer profile operations exist after auth. See [src/routes/customers.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/customers.ts#L16).

Gap analysis:

- **FAIL / CRITICAL**: Registration is not implemented here and is split across `auth` plus uploads.
- **FAIL / HIGH**: `GET /api/customers` and `GET /api/customers/:id` return `idNumber` and `idImageUrl` to non-admin roles, including customers and branch staff/managers, which violates the requirement that customer ID retrieval be admin-only. See [src/routes/customers.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/customers.ts#L56) and [src/routes/customers.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/customers.ts#L210).
- **FAIL / HIGH**: `PATCH` allows branch staff/managers to update any customer profile, not branch-scoped only and not admin-only for ID-related data. See [src/routes/customers.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/customers.ts#L358).
- **FAIL / MEDIUM**: No audit logging for customer profile create/update.

### `src/routes/queue.ts`

Endpoints:

- `GET /api/queue/status`
- `POST /api/queue/join`
- `GET /api/queue/my-status`
- `POST /api/queue/leave`

Challenge requires:

- Queue endpoints are not part of the listed must-have contract; bonus work is only allowed after required items pass.

Current behavior:

- All endpoints return `501 Not implemented`. See [src/routes/queue.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/queue.ts#L5).

Gap analysis:

- **NEUTRAL / LOW**: These routes are outside the required scope, but they add unfinished surface area and reviewer noise.
- **MEDIUM reviewer risk**: Placeholder endpoints reinforce that the repo is not aligned to the “no TODO / no placeholder routes in required scope” principle from the master prompt.

### `src/routes/service-types.ts`

Endpoints:

- `GET /api/service-types`
- `POST /api/service-types`
- `GET /api/service-types/:id`
- `PATCH /api/service-types/:id`
- `DELETE /api/service-types/:id`

Challenge requires:

- Public endpoint for services by branch
- Admin/manager branch-scoped management

Current behavior:

- `GET /api/service-types` is public and supports `branchId` query filtering. See [src/routes/service-types.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/service-types.ts#L15).
- CRUD exists for authenticated admins/managers. See [src/routes/service-types.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/service-types.ts#L75).

Gap analysis:

- **PARTIAL / MEDIUM**: Public “services by branch” can be approximated via `GET /api/service-types?branchId=...`, but the contract calls for an explicit public endpoint for services by branch, not an implicit generic list.
- **FAIL / MEDIUM**: Public `GET /api/service-types` is not limited to active branches/services by default.
- **FAIL / MEDIUM**: `GET /:id` requires auth, which weakens public discovery of branch services.
- **FAIL / MEDIUM**: No audit logging for service type create/update/delete.

### `src/routes/slots.ts`

Endpoints:

- `GET /api/slots`
- `POST /api/slots`
- `POST /api/slots/cleanup-retention`
- `GET /api/slots/retention-preview`
- `GET /api/slots/:id`
- `PATCH /api/slots/:id`
- `DELETE /api/slots/:id`

Challenge requires:

- Public endpoint for available slots by branch + service + optional date
- Slot deletion must be soft delete
- Soft-deleted slots hidden from normal listings
- Retention days stored in DB and configurable by admin only
- Cleanup idempotent

Current behavior:

- `GET /api/slots` is public and supports branch/service/date filters. See [src/routes/slots.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/slots.ts#L16).
- `DELETE /api/slots/:id` soft-deletes by setting `deletedAt`. See [src/routes/slots.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/slots.ts#L709).
- Retention cleanup is admin-only, but configured through `?days=` query input. See [src/routes/slots.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/slots.ts#L242).

Gap analysis:

- **PARTIAL / MEDIUM**: Public available-slot listing exists, but the route is generic rather than an explicit public availability contract.
- **FAIL / CRITICAL**: No DB-backed retention configuration model or admin config endpoint.
- **FAIL / HIGH**: Cleanup is manually invoked via endpoint rather than driven by persisted retention policy.
- **FAIL / HIGH**: `GET /api/slots/:id` requires auth, which is stricter than the public availability requirement.
- **FAIL / MEDIUM**: `GET /api/slots` uses `prisma.slot.fields.capacity` in the filter. That is not a valid persisted rule for enforcing “bookedCount < capacity” at the DB level and is a correctness risk. See [src/routes/slots.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/slots.ts#L59).
- **PARTIAL**: Soft delete behavior is present and default exclusion of deleted slots is present.

### `src/routes/staff.ts`

Endpoints:

- `GET /api/staff`
- `POST /api/staff`
- `GET /api/staff/:id`
- `PATCH /api/staff/:id`
- `DELETE /api/staff/:id`

Challenge requires:

- Staff and managers have branch-scoped visibility
- Staff can view their schedule / assigned appointments
- Staff/managers can update appointment status within scope

Current behavior:

- Router is auth-protected. See [src/routes/staff.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/staff.ts#L10).
- Branch-scoped listing and CRUD exist. See [src/routes/staff.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/staff.ts#L13).

Gap analysis:

- **PARTIAL / MEDIUM**: Branch-scoped staff management exists.
- **FAIL / MEDIUM**: No explicit staff schedule endpoint; schedule data is only embedded in staff detail via recent `slotAssignments`.
- **FAIL / MEDIUM**: Staff creation assumes the user account already exists; there is no end-to-end staff onboarding flow tied to the challenge contract.
- **FAIL / LOW**: Delete is hard delete; reviewer-safe administrative changes usually should preserve history.

### `src/routes/uploads.ts`

Endpoints:

- `GET /api/files/customer-id/:customerId`
- `GET /api/files/appointment/:appointmentId/attachment`
- `POST /api/uploads/customer-id`
- `POST /api/uploads/appointment-attachment`

Challenge requires:

- Customer registration must include ID image upload inline
- Customer ID retrieval must be admin-only
- Appointment attachment retrieval must enforce permissions and content type

Current behavior:

- Auth is required for the whole router. See [src/routes/uploads.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/uploads.ts#L13).
- Customer ID retrieval is admin-only. See [src/routes/uploads.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/uploads.ts#L17).
- Appointment attachment retrieval enforces role/ownership and sets `Content-Type`. See [src/routes/uploads.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/uploads.ts#L95).

Gap analysis:

- **FAIL / CRITICAL**: Separate upload endpoints are used as a substitute for inline registration upload.
- **PARTIAL / MEDIUM**: Attachment retrieval permissions and content type handling are present.
- **FAIL / MEDIUM**: `customer.idImageUrl` and `appointment.attachmentUrl` are stored as URL-like strings beginning with `/uploads/...`; retrieval then joins them with `process.cwd()`, producing path handling that is brittle and easy to mis-resolve. See [src/routes/uploads.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/uploads.ts#L53) and [src/routes/uploads.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/uploads.ts#L160).
- **FAIL / MEDIUM**: Upload routes permit PDF for customer ID, while the contract specifically calls for an ID image.

## Model Assessment

Required entities from the contract:

- `Branch`
- `ServiceType`
- `Slot`
- `Staff`
- `Customer`
- `Appointment`
- `AuditLog`

Present in schema:

- All required entities exist in [prisma/schema.prisma](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/schema.prisma#L43).

Gaps and issues:

- **FAIL / CRITICAL**: No database model for retention configuration. The contract requires retention days to be stored in the database and configurable by admin. There is no `SystemConfig`, `RetentionPolicy`, or equivalent table. See [prisma/schema.prisma](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/schema.prisma#L15).
- **FAIL / HIGH**: Auth model is password/JWT-oriented through `User.password`, but there is no schema support for the required Basic Auth contract beyond raw credentials. The real issue is implementation, but the model reinforces the wrong flow.
- **FAIL / HIGH**: `Customer.idNumber` and `Customer.idImageUrl` are nullable, even though registration requires capturing the customer ID artifact. See [prisma/schema.prisma](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/schema.prisma#L44).
- **FAIL / HIGH**: `Appointment.serviceTypeId` is a scalar without a relation, so referential integrity is missing for a core required entity link. See [prisma/schema.prisma](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/schema.prisma#L173).
- **FAIL / MEDIUM**: No uniqueness constraint prevents duplicate booking of the same slot by the same customer.
- **FAIL / MEDIUM**: `AuditLog.branchId` is nullable and not derived automatically, which weakens manager-scoped audit visibility.
- **FAIL / MEDIUM**: No persisted metadata for who deleted a slot, why it was deleted, or retention policy version at deletion time.

## Middleware Assessment

### Auth

Current state:

- `authMiddleware` requires `Authorization: Bearer <jwt>` and verifies with `jsonwebtoken`. See [src/middleware/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/auth.ts#L24).
- `optionalAuthMiddleware` also assumes Bearer JWT. See [src/middleware/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/auth.ts#L271).

Assessment:

- **FAIL / CRITICAL**: Direct violation of the challenge requirement. JWT is explicitly forbidden as a replacement for Basic Auth.
- **FAIL / HIGH**: Route protection is inconsistent with the challenge statement “all APIs are protected except explicitly public endpoints” because some public endpoints are implemented by simply omitting auth middleware rather than by a clearly defined public contract.

### Upload handling

Current state:

- Multer stores files on local disk under `uploads/`. See [src/middleware/upload.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/upload.ts#L7).
- Allowed types include images and PDFs. See [src/middleware/upload.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/upload.ts#L36).
- Max file size is 5 MB. See [src/middleware/upload.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/upload.ts#L55).

Assessment:

- **PARTIAL / MEDIUM**: Basic size/type validation exists.
- **FAIL / HIGH**: Upload handling is not integrated into registration.
- **FAIL / MEDIUM**: Customer ID upload accepts PDFs even though the requirement is an ID image.
- **FAIL / MEDIUM**: Storage strategy is path-string based and not modeled as a first-class protected asset record.

### Error handling

Current state:

- Global error handler returns a generic 500. See [src/index.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/index.ts#L73).
- Route handlers mostly do their own `try/catch`.
- Multer errors are handled separately. See [src/middleware/upload.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/upload.ts#L64).

Assessment:

- **PARTIAL / LOW**: There is a catch-all handler.
- **FAIL / MEDIUM**: Error handling is fragmented and not normalized; validation, Prisma, and auth failures are shaped differently across routes.
- **FAIL / LOW**: The global handler drops context and does not map known operational errors into stable API errors.

## Specific Violations Required To Flag

- **JWT auth instead of Basic Auth**: confirmed in [src/middleware/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/middleware/auth.ts#L18) and [src/utils/jwt.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/utils/jwt.ts).
- **Manual seed instead of startup import**: confirmed in [prisma/seed.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/seed.ts#L16) and absence of startup import logic in [src/index.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/index.ts#L82).
- **Separate upload endpoint instead of inline registration**: confirmed across [src/routes/auth.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/auth.ts#L11) and [src/routes/uploads.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/uploads.ts#L202).
- **No DB-backed retention config**: confirmed by query-param retention cleanup in [src/routes/slots.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/routes/slots.ts#L245) and missing schema support in [prisma/schema.prisma](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/schema.prisma#L15).
- **Missing audit trail coverage**: confirmed by limited audit action set and sparse usage in [src/utils/audit-logger.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/utils/audit-logger.ts#L6).

## Seed / Bootstrap Assessment

Current behavior:

- Seed script deletes all data and recreates hard-coded sample records. See [prisma/seed.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/seed.ts#L19).
- Default admin is created only inside the seed script. See [prisma/seed.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/prisma/seed.ts#L36).
- No startup bootstrap/import logic exists in the app entrypoint. See [src/index.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/index.ts#L82).

Assessment:

- **FAIL / CRITICAL**: Not startup-driven.
- **FAIL / CRITICAL**: Not idempotent; destructive reset deletes reviewer-created data.
- **FAIL / CRITICAL**: Does not read the provided JSON file.
- **PARTIAL**: A default admin can exist after running the seed, but that does not satisfy the startup requirement.

## Audit Trail Assessment

Implemented coverage:

- Appointment create/cancel/status change
- Slot create/update/delete/cleanup
- Staff assignment changes
- File access/upload events

Missing or weak coverage:

- Login and registration are not audited even though action types exist for them. See [src/utils/audit-logger.ts](/home/abdullah/Projects/codestacker-2026-flowcare-backend/src/utils/audit-logger.ts#L19).
- Branch and service-type management are not audited.
- Customer profile create/update is not audited.
- Retention configuration changes cannot be audited because no such config exists.
- Many audit writes omit `branchId`, undermining manager branch-only views.

Assessment:

- **FAIL / CRITICAL**: “Missing audit trail coverage” is valid.

## Summary Table

| Feature | Required | Current | Status | Priority |
|---|---|---|---|---|
| Authentication | Basic Auth | JWT bearer tokens | FAIL | CRITICAL |
| Default admin | Exists at startup | Created only by manual seed | FAIL | CRITICAL |
| Protected API contract | All non-public routes protected | Mixed, JWT-based | FAIL | CRITICAL |
| Public branches | Public listing | `GET /api/branches` public | PARTIAL | MEDIUM |
| Public services by branch | Explicit public service listing by branch | Generic public `GET /api/service-types?branchId=` | PARTIAL | MEDIUM |
| Public available slots | Public branch/service/date availability | Generic public `GET /api/slots` | PARTIAL | MEDIUM |
| Registration with ID image | Inline upload during registration | Split across register + upload endpoint | FAIL | CRITICAL |
| Customer login contract | Required auth flow | JWT login response | FAIL | CRITICAL |
| Customer book own appointment | Supported | Supported with gaps | PARTIAL | HIGH |
| Customer reschedule | Required | Missing dedicated reschedule support | FAIL | HIGH |
| Customer cancel | Required | Supported, but delete hard-removes record | PARTIAL | HIGH |
| Staff schedule visibility | Required | Indirect via staff detail / appointments | PARTIAL | MEDIUM |
| Staff status updates | Required | `PATCH /api/appointments/:id` | PARTIAL | MEDIUM |
| Manager branch scoping | Required | Implemented in many routes | PARTIAL | MEDIUM |
| Seed import source | Provided JSON file | Hard-coded objects | FAIL | CRITICAL |
| Seed import timing | At startup | Manual script only | FAIL | CRITICAL |
| Seed idempotency | Must be idempotent | Destructive reset | FAIL | CRITICAL |
| Slot delete semantics | Soft delete | `deletedAt` soft delete present | PARTIAL | MEDIUM |
| Retention config storage | DB-backed days value | Query parameter only | FAIL | CRITICAL |
| Retention config permissions | Admin only | No config endpoint/model | FAIL | CRITICAL |
| Cleanup idempotency | Required | Endpoint is rerunnable, but policy source is wrong | PARTIAL | HIGH |
| Audit log coverage | Sensitive actions covered | Partial coverage only | FAIL | CRITICAL |
| Audit log visibility | Admin all, manager branch only | Route exists, data quality weak | PARTIAL | HIGH |
| Audit CSV export | Admin export | Implemented | PARTIAL | MEDIUM |
| Customer ID retrieval | Admin only | File route admin-only, customer routes leak metadata | FAIL | HIGH |
| Attachment retrieval | Permissioned + content-type | Implemented | PARTIAL | MEDIUM |

## Bottom Line

The repo has useful building blocks, especially around branch scoping, soft-delete scaffolding for slots, and permissioned file retrieval. It is not challenge-compliant yet because several non-negotiable contracts are implemented with forbidden substitutions: JWT for Basic Auth, manual destructive seeding for startup JSON import, separate upload endpoints for registration, query-param retention instead of DB-backed configuration, and incomplete audit coverage.
