# FlowCare Current-State Audit

Date: 2026-03-10
Scope: `src/routes/*.ts`, `src/middleware/*.ts`, `src/utils/*.ts`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/index.ts`
Source of truth: `~/.openclaw/workspace/knowledge/flowcare-master-prompt.md`, `docs/REQUIREMENTS_TRACEABILITY.md`

## Audit Summary

Overall status: `non-compliant`

Highest-risk contract failures:

1. Authentication is JWT/Bearer, not required Basic Auth.
2. Registration does not include inline customer-ID image upload.
3. Seed import is manual, hard-coded, destructive, and not startup-driven.
4. Retention days are query-driven, not DB-backed and admin-configurable.
5. Audit coverage and branch scoping are incomplete.

## 1. File-By-File Audit

### `src/index.ts`

What it currently does:
- Boots Express, enables CORS and JSON parsing, exposes `GET /health`, mounts all routers, and starts listening immediately.
- Mounts the same upload router twice: `/api/uploads` and `/api/files` (`lines 62-63`).

What the challenge requires:
- Startup must ensure the system has a default Admin user.
- Seed import must run at startup, read the provided JSON file, and be idempotent.
- All non-public APIs must be protected by the required Basic Auth contract.

Specific violations:
- `lines 53-63`: mounts routers that are implemented around JWT auth, so the protected API surface is wired to the wrong auth contract.
- `lines 62-63`: mounts upload routes under both `/api/uploads` and `/api/files`, creating duplicate public API surface that is not reflected in the challenge contract.
- `lines 82-87`: starts the server without any startup seed/bootstrap hook, so default admin and JSON import are not guaranteed at startup.

Required changes:
- Add startup bootstrap before `app.listen()` for idempotent JSON seed import and default admin assurance.
- Replace JWT-based route protection assumptions with Basic Auth middleware.
- Rationalize file-route mounting so only the intended contract paths remain.

### `src/middleware/auth.ts`

What it currently does:
- Parses `Authorization: Bearer <token>`, verifies JWT, and enriches `req.user` with branch/customer profile context.
- Provides role, branch-scope, ownership, and optional-auth helpers.

What the challenge requires:
- Basic Authentication is required.
- All protected routes must use the required auth mechanism.
- Role and branch isolation must work on top of that Basic Auth contract.

Specific violations:
- `lines 18-19`: defines JWT secret state, showing the auth layer is token-based.
- `lines 30-40`: explicitly requires `Bearer` authorization.
- `lines 42-44` and `287-288`: verifies JWT and trusts token claims instead of Basic credentials.
- `lines 271-314`: optional JWT auth exists even though the contract only names public endpoints plus protected Basic-auth endpoints.

Required changes:
- Replace JWT parsing with Basic Auth credential parsing and user lookup.
- Rebuild `req.user` enrichment from database-backed user/session context after Basic verification.
- Keep RBAC and branch-scoping helpers, but make them independent of JWT payloads.

### `src/middleware/upload.ts`

What it currently does:
- Stores files under `uploads/`, `uploads/customer-ids/`, or `uploads/appointment-attachments/`.
- Accepts images and PDFs up to 5 MB.

What the challenge requires:
- Customer registration must include required ID-image upload inline.
- Appointment attachments are optional, but retrieval must enforce permissions and content-type.
- Secure file handling must support the route contract.

Specific violations:
- `lines 12-15`: route file handling is keyed only by field name, not by a registration workflow or stricter contract-specific validation.
- `lines 36-45`: allows PDF upload for customer ID images even though the prompt speaks in terms of a required ID image.
- `lines 56-62`: upload policy is standalone; it is not integrated into registration, which is the required path.

Required changes:
- Split validation by use case: stricter customer-ID image validation during registration, optional appointment-attachment validation separately.
- Wire ID upload middleware directly into registration instead of a separate follow-up endpoint.

### `src/utils/audit-logger.ts`

What it currently does:
- Persists audit rows with `userId`, `action`, `entity`, `entityId`, `metadata`, and `ipAddress`.
- Exposes a response-hook audit helper and request IP extraction.

What the challenge requires:
- Audit logs must capture sensitive actions with required fields, including branch context where needed.
- Admin must be able to view/export all logs; manager view must be branch-only.

Specific violations:
- `lines 40-48`: never writes `branchId` to the `AuditLog` row even though the schema supports it, so manager branch filtering is only as good as individual callers manually embedding branch info inside `metadata`.
- `lines 6-22`: action enum omits several challenge-critical events from actual coverage flow, including branch/service mutations, retention configuration changes, startup import, and file-permission-sensitive reads.
- `lines 78-109`: generic middleware exists but is not used across most mutating routes.

Required changes:
- Persist `branchId` as a first-class audit column.
- Expand audited actions to cover all required sensitive operations.
- Standardize route usage so every sensitive mutation and sensitive file access is audited consistently.

### `src/utils/file-storage.ts`

What it currently does:
- Provides helper paths for upload directories plus simple file metadata and deletion helpers.

What the challenge requires:
- Secure file handling for ID images and appointment attachments.
- Reviewer-safe, consistent storage behavior.

Specific violations:
- `lines 42-45`: file extension validation duplicates permissive upload rules and still treats PDF as valid for ID-image use.
- `lines 79-95`: `getFileMetadata()` returns blank MIME type and uses filename as original name, so it is not sufficient for a secure retrieval contract.
- `lines 105-118`: directory bootstrap helper exists but is not called from startup.

Required changes:
- Align helper rules with the final registration/attachment contract.
- Track and return actual metadata needed for permissioned retrieval.
- Call directory bootstrap from startup if local disk storage remains.

### `src/utils/jwt.ts`

What it currently does:
- Signs and verifies JWT bearer tokens.

What the challenge requires:
- Basic Authentication, not JWT.

Specific violations:
- `lines 4-14`: entire utility is an anti-spec implementation because Basic Auth is required and the master prompt explicitly forbids JWT as a substitute.

Required changes:
- Remove JWT auth from the request contract.
- Replace this utility with Basic-auth credential verification helpers if a shared auth utility is still needed.

### `src/routes/auth.ts`

What it currently does:
- `POST /api/auth/register`: JSON-only user registration, optional caller-supplied role, auto-created customer profile with fabricated `idNumber` and fixed DOB, returns JWT token.
- `POST /api/auth/login`: email/password login returning JWT token.

What the challenge requires:
- Public customer registration with required ID-image upload stored during registration.
- Login/auth flow that satisfies Basic Auth.
- Default admin existence independent of ad hoc registration.

Specific violations:
- `lines 13-24`: registration only validates JSON body; no multipart handling and no ID-image file.
- `lines 24-25` and `49`: accepts caller-supplied `role`, allowing non-customer registration through the public route.
- `lines 64-69`: fabricates customer `idNumber` and `dateOfBirth` instead of collecting required customer data.
- `lines 74-87` and `154-175`: both registration and login issue JWT tokens instead of Basic-auth responses.
- `lines 99-175`: login contract is token issuance rather than credential validation for Basic-auth usage.
- Entire file has no audit logging for `USER_REGISTERED` or `USER_LOGIN`.

Required changes:
- Convert registration to multipart form handling with inline ID-image upload and challenge-required customer fields.
- Restrict public registration to customer creation only.
- Replace JWT login/token issuance with Basic-auth-compliant credential handling.
- Add audit logging for registration and login.

### `src/routes/appointments.ts`

What it currently does:
- Auth-protected router for appointment list, create, read, patch, and delete.
- Supports booking, status changes, direct cancellation, and hard deletion.

What the challenge requires:
- Customers can book, cancel, reschedule, and view only their own appointments.
- Staff can view assigned schedule and update appointment status.
- Manager/admin visibility must be correctly scoped.

Specific violations:
- `line 11`: router protection depends on non-compliant JWT middleware.
- `lines 156-159`: customer identity is auto-filled from JWT state rather than Basic-auth-backed context.
- `lines 190-236`: booking validates slot capacity and service type but never verifies `data.branchId === slot.branchId`.
- `lines 238-298`: booking creates appointments without duplicate-slot booking protection for the same customer.
- `lines 428-491`: update schema and handler do not accept or process a new `slotId`, so reschedule is missing.
- `lines 463-487`: status flow updates timestamps, but there is no strong transition validation beyond a few happy-path checks.
- `lines 575-614`: `DELETE` hard-deletes the appointment record, which destroys history instead of preserving a cancelled appointment record.
- `lines 530-550`: audit only covers status changes; read access, reschedule, and delete-vs-cancel distinction are incomplete.

Required changes:
- Rework auth dependency to Basic Auth.
- Add explicit reschedule workflow that swaps slots transactionally and preserves appointment history.
- Validate slot/branch consistency and duplicate booking constraints.
- Replace hard delete with contract-compliant cancellation behavior.
- Tighten staff visibility to assigned schedule where required.

### `src/routes/audit.ts`

What it currently does:
- `GET /api/audit`: admin gets all logs, branch manager gets branch-filtered logs.
- `GET /api/audit/export`: admin exports CSV of all logs.

What the challenge requires:
- Admin can view/export all logs.
- Manager can view branch-only logs.
- Underlying audit rows must contain the required fields and branch scope.

Specific violations:
- `lines 57-68`: manager filtering depends on `AuditLog.branchId`, but many audit writes never populate that column.
- `lines 121-196`: export works only as well as underlying audit completeness; current audit dataset is missing required events from auth, branch/service changes, and retention configuration.

Required changes:
- Keep route surface, but fix upstream audit write quality.
- Verify branch context is always stored so manager filtering is reliable.

### `src/routes/branches.ts`

What it currently does:
- Public branch list plus authenticated branch CRUD.

What the challenge requires:
- Public branch discovery.
- Admin can manage all branches.
- Managers are branch-scoped.
- Sensitive actions should be audited.

Specific violations:
- `lines 21-25`: public `GET /api/branches` conditionally changes output based on `req.user`, but there is no optional auth middleware mounted here, so branch scoping inside the public handler is effectively dead logic.
- `line 136`: `GET /api/branches/:id` is authenticated only, which is stricter than the public-discovery surface expected by the challenge.
- `lines 247-262` and `291-293`: update/delete are implemented with no audit logging.
- `lines 287-293`: delete is destructive hard delete.

Required changes:
- Preserve public listing and decide whether public branch detail is required by the final contract.
- Add audit logging for create/update/delete.
- Prefer deactivation over destructive deletion if branch lifecycle needs to be reviewer-safe.

### `src/routes/customers.ts`

What it currently does:
- Auth-protected customer list, create, read, and update endpoints.
- Exposes customer personal data plus appointment history.

What the challenge requires:
- Registration must own customer creation.
- Customer ID retrieval must be admin-only.
- Customer/self-service visibility must avoid leaking sensitive ID data.

Specific violations:
- `line 10`: all routes depend on JWT auth.
- `lines 56-63`: list response exposes `idNumber` and `idImageUrl` to any authorized role allowed by the branch/customer filters.
- `lines 210-218`: detail response exposes `idNumber` and `idImageUrl` to customer, staff, and manager callers.
- `lines 101-170`: separate `POST /api/customers` creation path duplicates registration concerns and allows post-hoc profile creation instead of the required inline registration contract.
- `lines 329-399`: update path allows admin, manager, and staff to update sensitive customer ID fields without an admin-only restriction.
- Entire file has no audit logging.

Required changes:
- Move customer creation responsibility into registration.
- Strip ID fields from non-admin customer APIs.
- Limit sensitive customer-field updates to the correct roles.
- Add audit logging for customer mutations.

### `src/routes/queue.ts`

What it currently does:
- Declares four queue routes that all return `501 Not implemented`.

What the challenge requires:
- Queue work is bonus-only after required scope passes.
- No placeholder routes should distract from the required contract.

Specific violations:
- `lines 5-71`: unfinished placeholder endpoints add dead API surface.

Required changes:
- Remove the routes from the submission surface or fully implement them later as bonus work only after required compliance is complete.

### `src/routes/service-types.ts`

What it currently does:
- Public service-type listing plus authenticated CRUD.

What the challenge requires:
- Public services-by-branch endpoint.
- Admin/manager branch-scoped management.
- Audit sensitive changes.

Specific violations:
- `lines 17-34`: public listing is generic and optional-query-driven, not an explicit services-by-branch public contract.
- `line 163`: `GET /api/service-types/:id` requires auth, which weakens public discovery.
- `lines 121-145`, `299-318`, `372-374`: create/update/delete have no audit logging.
- `lines 372-374`: delete is hard delete.

Required changes:
- Expose a clear public branch-service discovery contract.
- Add audit logging for create/update/delete.
- Reconsider destructive delete behavior if reviewer-safe lifecycle management is needed.

### `src/routes/slots.ts`

What it currently does:
- Public slot listing plus authenticated slot CRUD, retention cleanup, preview, soft delete, and restore.

What the challenge requires:
- Public available slots by branch + service + optional date.
- Slot removal must be soft delete.
- Normal listings must hide soft-deleted slots.
- Retention days must live in the database and be admin-configurable.
- Cleanup must be idempotent.

Specific violations:
- `lines 18-19`: public filter shape is `startDate/endDate`; the challenge matrix expects an availability contract with optional date input.
- `lines 59-63`: uses `prisma.slot.fields.capacity` in query construction; that is not a valid persisted capacity comparison for Prisma queries and is a correctness bug for availability filtering.
- `line 245` and `line 357`: cleanup and preview are admin-only, but both are driven by `req.query.days` instead of DB-backed retention settings.
- `lines 249-262` and `361-374`: default retention is hard-coded to 30 days, not stored in the database.
- Entire file has no endpoint to configure retention days.
- `line 433`: slot detail requires auth even though slot availability is supposed to be publicly discoverable.
- `lines 779-791`: audit row for delete does not populate `AuditLog.branchId` first-class.

Required changes:
- Fix slot availability query semantics.
- Add DB-backed retention configuration model and admin-only config route.
- Make cleanup consume stored retention days and remain idempotent.
- Revisit public slot-detail/discovery contract.

### `src/routes/staff.ts`

What it currently does:
- Auth-protected staff list/create/read/update/delete.
- Enforces branch scope for managers and staff.
- Returns recent appointments and slot assignments on staff detail.

What the challenge requires:
- Staff and managers have branch-scoped visibility.
- Staff can view assigned schedule.
- Sensitive staff assignment changes are audited.

Specific violations:
- `line 11`: router protection depends on JWT auth.
- `lines 17-72`: list endpoint returns branch staff, but there is no dedicated assigned-schedule endpoint for the logged-in staff member.
- `lines 89-159`: staff creation requires pre-existing `User` records, but there is no compliant admin/staff account bootstrap flow tied to the required Basic-auth contract.
- `lines 482-484`: delete is hard delete.
- Audit exists for assignment changes, but no audit exists for view actions or downstream schedule/appointment access.

Required changes:
- Keep branch-scoped RBAC logic, but move it under Basic Auth.
- Add explicit assigned-schedule behavior if required by reviewer checks.
- Rework staff lifecycle so user creation/assignment is challenge-compliant.

### `src/routes/uploads.ts`

What it currently does:
- JWT-protected file retrieval for customer IDs and appointment attachments.
- Separate upload endpoints for customer IDs and appointment attachments.

What the challenge requires:
- Customer ID image must be uploaded during registration, not as a substitute endpoint.
- Customer ID retrieval must be admin-only.
- Appointment attachment retrieval must enforce permissions and content-type.

Specific violations:
- `line 14`: file routes depend on JWT auth.
- `lines 210-321`: separate customer-ID upload endpoint is a forbidden substitution for inline registration upload.
- `lines 210-238`: a customer can upload ID after account creation without any registration-time requirement.
- `lines 281-286` and `397-402`: stores raw file path strings only; there is no richer file metadata model.
- `lines 24-437`: because the router is mounted under both `/api/uploads` and `/api/files`, all four handlers are reachable under both prefixes, expanding the API surface beyond the described contract.

Required changes:
- Fold customer-ID upload into registration.
- Keep admin-only ID retrieval and appointment-attachment retrieval, but switch them to Basic-auth-backed access control.
- Reduce duplicate route mounting and clarify canonical file endpoints.

### `prisma/schema.prisma`

What it currently does:
- Defines `User`, `Customer`, `Staff`, `Branch`, `ServiceType`, `Slot`, `SlotAssignment`, `Appointment`, and `AuditLog`.
- Uses PostgreSQL Prisma models with soft-delete support for `Slot`.

What the challenge requires:
- Required entities: `Branch`, `ServiceType`, `Slot`, `Staff`, `Customer`, `Appointment`, `AuditLog`.
- DB-backed retention days configuration.
- Branch context on audit logs.
- Data model that supports required workflows safely.

Specific violations:
- `lines 15-230`: no model exists for retention configuration, system settings, or any DB-backed `retentionDays` value.
- `lines 173-201`: `Appointment` has `serviceTypeId String` but no `@relation` to `ServiceType`, weakening referential integrity for a core workflow field.
- `lines 173-201`: no uniqueness constraint prevents the same customer from booking the same slot more than once.
- `lines 213-223`: `AuditLog.branchId` exists as a plain string but has no relation or stronger integrity guarantee to `Branch`.
- `lines 44-59`: `Customer.idImageUrl` is optional, which is inconsistent with a registration contract that requires ID-image storage at registration time.

Required changes:
- Add a DB-backed retention settings model or equivalent.
- Add missing appointment-to-service-type relation and any required booking uniqueness constraints.
- Decide whether customer ID image should be required post-registration and enforce that consistently.
- Consider stronger relational integrity for audit branch context.

### `prisma/seed.ts`

What it currently does:
- Deletes all data, recreates admin, branches, services, staff, customers, slots, one sample appointment, and one audit row from hard-coded TypeScript data.

What the challenge requires:
- Seed data must import from the provided JSON file.
- Seed import must happen at startup.
- Seed behavior must be idempotent and non-destructive.
- System must start with a default Admin user.

Specific violations:
- `lines 19-29`: destructive reset using `deleteMany()` across all domain tables; this is not idempotent reviewer-safe import.
- `lines 36-46`, `52-322`: all seed data is hard-coded in TypeScript instead of imported from the provided JSON file.
- `lines 31-351`: uses randomized phone numbers and generated IDs, so repeated runs do not converge to stable state.
- `lines 328-341`: writes a `DATABASE_SEED` audit action that is not part of the typed audit action union in `src/utils/audit-logger.ts`.
- File is not connected to startup anywhere in `src/index.ts`.

Required changes:
- Replace destructive seed with convergent import from the provided JSON artifact.
- Invoke bootstrap from startup.
- Keep default admin creation idempotent and separate from destructive reset behavior.

## 2. Route-By-Route Compliance Check

`src/index.ts` mounts `src/routes/uploads.ts` under both `/api/uploads` and `/api/files`, so those handlers exist under both prefixes.

| method | path | current purpose | mapped requirement | status | evidence |
|---|---|---|---|---|---|
| GET | `/health` | Health check | Reviewer UX / operability | compliant | `src/index.ts:41-50` |
| POST | `/api/auth/register` | Public registration + JWT issuance | Registration with inline ID-image upload | non-compliant | `src/routes/auth.ts:11-88` |
| POST | `/api/auth/login` | Email/password login returning JWT | Basic Authentication contract | non-compliant | `src/routes/auth.ts:99-175` |
| GET | `/api/appointments` | List appointments by role | Customer/staff/manager appointment visibility | non-compliant | `src/routes/appointments.ts:17-135` |
| POST | `/api/appointments` | Book appointment | Customer booking | non-compliant | `src/routes/appointments.ts:141-328` |
| GET | `/api/appointments/:id` | Appointment detail | Customer own-appointment view | non-compliant | `src/routes/appointments.ts:331-424` |
| PATCH | `/api/appointments/:id` | Status/cancel update | Cancel + reschedule + status workflow | non-compliant | `src/routes/appointments.ts:428-573` |
| DELETE | `/api/appointments/:id` | Hard delete appointment | Cancel own appointment while preserving record | non-compliant | `src/routes/appointments.ts:576-648` |
| GET | `/api/queue/status` | Placeholder queue status | Bonus only | non-compliant | `src/routes/queue.ts:7-20` |
| POST | `/api/queue/join` | Placeholder queue join | Bonus only | non-compliant | `src/routes/queue.ts:24-37` |
| GET | `/api/queue/my-status` | Placeholder queue status | Bonus only | non-compliant | `src/routes/queue.ts:41-54` |
| POST | `/api/queue/leave` | Placeholder queue leave | Bonus only | non-compliant | `src/routes/queue.ts:58-71` |
| GET | `/api/branches` | Public branch list | Public branches endpoint | compliant | `src/routes/branches.ts:14-66` |
| POST | `/api/branches` | Create branch | Admin manages all branches | non-compliant | `src/routes/branches.ts:69-133` |
| GET | `/api/branches/:id` | Branch detail | Public branch discovery / branch visibility | non-compliant | `src/routes/branches.ts:136-218` |
| PATCH | `/api/branches/:id` | Update branch | Admin/managers manage branches in scope | non-compliant | `src/routes/branches.ts:221-284` |
| DELETE | `/api/branches/:id` | Hard delete branch | Admin branch lifecycle | non-compliant | `src/routes/branches.ts:287-318` |
| GET | `/api/service-types` | Public service-type list | Public services by branch | non-compliant | `src/routes/service-types.ts:15-73` |
| POST | `/api/service-types` | Create service type | Admin/manager branch-scoped management | non-compliant | `src/routes/service-types.ts:76-160` |
| GET | `/api/service-types/:id` | Service-type detail | Public service discovery | non-compliant | `src/routes/service-types.ts:163-237` |
| PATCH | `/api/service-types/:id` | Update service type | Admin/manager branch-scoped management | non-compliant | `src/routes/service-types.ts:240-340` |
| DELETE | `/api/service-types/:id` | Hard delete service type | Admin/manager branch-scoped management | non-compliant | `src/routes/service-types.ts:343-400` |
| GET | `/api/slots` | Public slot list | Public available slots by branch/service/date | non-compliant | `src/routes/slots.ts:16-113` |
| POST | `/api/slots` | Create slot | Admin/manager slot management | non-compliant | `src/routes/slots.ts:116-240` |
| POST | `/api/slots/cleanup-retention` | Delete expired soft-deleted slots | Idempotent cleanup using DB-backed retention | non-compliant | `src/routes/slots.ts:245-352` |
| GET | `/api/slots/retention-preview` | Preview cleanup | Reviewer/admin retention verification | non-compliant | `src/routes/slots.ts:357-429` |
| GET | `/api/slots/:id` | Slot detail | Public slot discovery | non-compliant | `src/routes/slots.ts:433-551` |
| PATCH | `/api/slots/:id` | Update slot | Admin/manager slot management | non-compliant | `src/routes/slots.ts:554-707` |
| DELETE | `/api/slots/:id` | Soft delete slot | Slot soft delete | compliant | `src/routes/slots.ts:711-813` |
| POST | `/api/slots/:id/restore` | Restore slot | Extra admin recovery flow | non-compliant | `src/routes/slots.ts:817-907` |
| GET | `/api/staff` | Staff list | Branch-scoped staff visibility | non-compliant | `src/routes/staff.ts:17-86` |
| POST | `/api/staff` | Create staff assignment | Branch-scoped staff management | non-compliant | `src/routes/staff.ts:89-214` |
| GET | `/api/staff/:id` | Staff detail | Staff assigned schedule / branch visibility | non-compliant | `src/routes/staff.ts:217-323` |
| PATCH | `/api/staff/:id` | Update staff assignment | Branch-scoped staff management | non-compliant | `src/routes/staff.ts:326-443` |
| DELETE | `/api/staff/:id` | Delete staff assignment | Branch-scoped staff lifecycle | non-compliant | `src/routes/staff.ts:446-522` |
| GET | `/api/customers` | Customer list | Customer/self-service data visibility | non-compliant | `src/routes/customers.ts:16-96` |
| POST | `/api/customers` | Create customer profile | Registration / customer profile creation | non-compliant | `src/routes/customers.ts:101-203` |
| GET | `/api/customers/:id` | Customer detail | Customer own profile / admin-only ID retrieval | non-compliant | `src/routes/customers.ts:206-327` |
| PATCH | `/api/customers/:id` | Update customer | Customer profile update with proper permissions | non-compliant | `src/routes/customers.ts:330-420` |
| GET | `/api/audit` | Audit list | Admin all logs, manager branch-only logs | non-compliant | `src/routes/audit.ts:12-119` |
| GET | `/api/audit/export` | Audit CSV export | Admin export all logs | non-compliant | `src/routes/audit.ts:122-196` |
| GET | `/api/uploads/customer-id/:customerId` | Retrieve customer ID image | Customer ID retrieval admin-only | non-compliant | `src/routes/uploads.ts:24-93`, `src/index.ts:62` |
| GET | `/api/files/customer-id/:customerId` | Retrieve customer ID image | Customer ID retrieval admin-only | non-compliant | `src/routes/uploads.ts:24-93`, `src/index.ts:63` |
| GET | `/api/uploads/appointment/:appointmentId/attachment` | Retrieve appointment attachment | Permissioned attachment retrieval | non-compliant | `src/routes/uploads.ts:104-200`, `src/index.ts:62` |
| GET | `/api/files/appointment/:appointmentId/attachment` | Retrieve appointment attachment | Permissioned attachment retrieval | non-compliant | `src/routes/uploads.ts:104-200`, `src/index.ts:63` |
| POST | `/api/uploads/customer-id` | Upload customer ID image | Registration must include inline ID upload | non-compliant | `src/routes/uploads.ts:210-321`, `src/index.ts:62` |
| POST | `/api/files/customer-id` | Upload customer ID image | Registration must include inline ID upload | non-compliant | `src/routes/uploads.ts:210-321`, `src/index.ts:63` |
| POST | `/api/uploads/appointment-attachment` | Upload appointment attachment | Optional attachment upload | non-compliant | `src/routes/uploads.ts:331-437`, `src/index.ts:62` |
| POST | `/api/files/appointment-attachment` | Upload appointment attachment | Optional attachment upload | non-compliant | `src/routes/uploads.ts:331-437`, `src/index.ts:63` |

Missing required routes or route behavior:

| missing item | mapped requirement | evidence |
|---|---|---|
| Basic-auth-protected API contract | `FC-MUST-001`, `FC-MUST-006` | No route or middleware parses Basic credentials; auth is JWT-only. |
| Inline multipart registration with ID image | `FC-MUST-005` | Registration is JSON-only in `src/routes/auth.ts:11-88`. |
| Admin-only DB-backed retention configuration route | `FC-MUST-013`, `FC-MUST-014` | No route exists in `src/routes/slots.ts`. |
| Appointment reschedule route/behavior | `FC-MUST-007` | `PATCH /api/appointments/:id` cannot change slot. |
| Startup bootstrap route behavior for seed import | `FC-MUST-002`, `FC-MUST-009`, `FC-MUST-010` | `src/index.ts:82-87` only starts the server. |

## 3. Prisma Schema Audit

### Models present

| model | status | audit |
|---|---|---|
| `User` | partial | Supports email/password/role identity (`prisma/schema.prisma:16-34`), but the app uses it for JWT auth instead of Basic Auth. No explicit support for default-admin bootstrap beyond seed script behavior. |
| `Customer` | partial | Contains `idNumber`, `dateOfBirth`, and `idImageUrl` (`44-59`). `idImageUrl` is optional even though registration must store required ID image. |
| `Staff` | partial | Correctly relates user to branch (`62-81`). Supports manager flag and assignments, but staff-schedule workflows are not fully modeled in routes. |
| `Branch` | partial | Core branch model exists (`84-105`). No lifecycle metadata beyond `isActive`; destructive delete is used in routes. |
| `ServiceType` | partial | Core branch relation and fields exist (`108-128`). Appointment model does not relate back to it, weakening workflow integrity. |
| `Slot` | partial | Has required branch/service/time/capacity fields and `deletedAt` for soft delete (`131-155`). Retention policy is not modeled in schema. |
| `SlotAssignment` | partial | Supports assigned staff per slot (`158-170`). Good foundation for staff schedule, but not enough on its own to satisfy route contract. |
| `Appointment` | partial | Core booking fields exist (`173-201`), but `serviceTypeId` is just a scalar string, not a relation. No uniqueness guard against duplicate booking of same slot by same customer. |
| `AuditLog` | partial | Required entity exists (`213-230`) with `branchId`, metadata, and IP fields. `branchId` is not a relation and is often not populated by code. |

### Missing models / fields / constraints against the challenge

| gap | why it matters | evidence |
|---|---|---|
| No DB-backed retention config model | Challenge requires retention days stored in DB and admin-configurable | `prisma/schema.prisma:15-230` |
| No `Appointment.serviceType` relation | Core appointment-service integrity is not enforced | `prisma/schema.prisma:173-201` |
| No uniqueness on appointment booking per customer/slot | Challenge acceptance includes customer booking one slot once only | `prisma/schema.prisma:173-201` |
| `Customer.idImageUrl` optional | Registration is supposed to store required ID image | `prisma/schema.prisma:50` |
| `AuditLog.branchId` not relational | Branch-only audit filtering is weaker and easier to corrupt | `prisma/schema.prisma:220` |

## 4. Ordered Change List With Effort

| order | file | why it changes first | estimated effort |
|---|---|---|---|
| 1 | `src/middleware/auth.ts` | Core contract blocker: every protected route depends on wrong auth mechanism | large |
| 2 | `src/routes/auth.ts` | Registration and login both violate hard requirements | large |
| 3 | `prisma/schema.prisma` | Needed for retention config, stronger appointment integrity, and registration/file constraints | large |
| 4 | `prisma/seed.ts` | Startup JSON import and idempotency are hard blockers | large |
| 5 | `src/index.ts` | Must run bootstrap at startup and clean route mounting | medium |
| 6 | `src/routes/appointments.ts` | Missing reschedule and wrong cancellation semantics | large |
| 7 | `src/routes/uploads.ts` | Must fold ID upload into registration and keep secure retrieval | medium |
| 8 | `src/routes/slots.ts` | Retention config and availability correctness are still open | large |
| 9 | `src/utils/audit-logger.ts` | Required so audit visibility and exports become trustworthy | medium |
| 10 | `src/routes/customers.ts` | Currently leaks ID data and duplicates registration concerns | medium |
| 11 | `src/routes/branches.ts` | Needs audit coverage and possible public-detail adjustment | medium |
| 12 | `src/routes/service-types.ts` | Needs public-contract cleanup and audit coverage | medium |
| 13 | `src/routes/staff.ts` | Mostly structural cleanup after auth/schema fixes | medium |
| 14 | `src/middleware/upload.ts` | Validation should match final registration/attachment contract | small |
| 15 | `src/utils/file-storage.ts` | Supporting utility cleanup after storage contract is settled | small |
| 16 | `src/routes/audit.ts` | Route surface is close; depends on upstream audit fixes | small |
| 17 | `src/utils/jwt.ts` | Remove or replace once auth refactor lands | small |
| 18 | `src/routes/queue.ts` | Remove or defer placeholder bonus routes | small |

## 5. PASS / PARTIAL / FAIL Snapshot

| area | status | basis |
|---|---|---|
| Basic Auth contract | fail | JWT/Bearer implemented instead |
| Default admin at startup | fail | Only created by manual seed script |
| Public branches endpoint | pass | `GET /api/branches` is public |
| Public services-by-branch | fail | Generic list exists, but contract is not explicit and detail route is protected |
| Public available slots | partial | Public list exists, but filtering/availability logic is not contract-safe |
| Inline registration with ID image | fail | Separate upload endpoint used instead |
| Customer book/view/cancel/reschedule | partial | Book/view/cancel exist; reschedule missing; cancellation semantics wrong |
| Branch-scoped staff/manager access | partial | Scope checks exist, but auth contract is wrong and assigned-schedule behavior is weak |
| Slot soft delete | pass | `deletedAt` soft delete implemented |
| DB-backed retention config | fail | No schema model or config route |
| Idempotent cleanup | partial | Cleanup reruns safely, but uses query-param retention instead of DB config |
| Audit view/export | partial | Routes exist, but underlying audit rows are incomplete/inconsistently scoped |
| Customer ID retrieval admin-only | partial | Retrieval route is admin-only, but customer APIs leak ID fields |
| Appointment attachment retrieval | partial | Permissions and content-type are implemented, but auth contract is wrong |
| Startup JSON seed import | fail | No startup import, hard-coded destructive seed |
