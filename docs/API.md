# API Reference

Base URL: `http://localhost:3000`

Protected routes use HTTP Basic Authentication:

```bash
curl -u admin@flowcare.com:YOUR_ADMIN_PASSWORD http://localhost:3000/api/audit
```

Appointment statuses exposed by the API are `scheduled`, `checked-in`, `in-progress`, `completed`, `cancelled`, and `no-show`. Legacy aliases such as `WAITING`, `SERVING`, and `DONE` are still accepted on input, but serializer output always uses the canonical values.

## Response Conventions

Successful JSON responses:

```json
{
  "success": true,
  "data": {}
}
```

Error JSON responses:

```json
{
  "success": false,
  "error": "Human readable message",
  "details": []
}
```

## Public Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Health check |
| `GET` | `/api/branches` | Public | List branches |
| `GET` | `/api/service-types` | Public | List service types; optional `branchId`, `isActive` |
| `GET` | `/api/slots` | Public | List public slots; optional `branchId`, `serviceTypeId`, `startDate`, `endDate`, `available`; never returns soft-deleted rows |
| `POST` | `/api/auth/register` | Public | Register customer with multipart ID image |
| `POST` | `/api/auth/login` | Public | Validate Basic Authentication credentials and record login attempt |

Example login:

```bash
curl -X POST -u admin@flowcare.com:YOUR_ADMIN_PASSWORD http://localhost:3000/api/auth/login
```

Example registration:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -F email=customer@example.com \
  -F password=password123 \
  -F firstName=Jane \
  -F lastName=Doe \
  -F phone=+15550000000 \
  -F idNumber=ID-123456 \
  -F dateOfBirth=1995-05-20 \
  -F idImage=@/absolute/path/to/id-card.png
```

## Appointments

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/appointments` | Any authenticated user | Customers see own, staff see assigned-to-me only, managers see assigned branch, admin sees all |
| `POST` | `/api/appointments` | Customer, Staff, Branch Manager, Admin | Primary booking contract. Accepts `multipart/form-data`, reads text fields from `req.body`, and accepts optional `attachment` in `req.file` |
| `GET` | `/api/appointments/:id` | Any authenticated user with access | Customers own only; staff assigned-only; managers branch scoped |
| `PATCH` | `/api/appointments/:id` | Any authenticated user with access | Reschedule with `slotId` (not staff), update notes, or update status using canonical values (staff cannot cancel) |
| `DELETE` | `/api/appointments/:id` | Customer, Branch Manager, Admin | Cancel appointment record (staff cannot cancel) |

Book with no attachment:

```bash
curl -X POST http://localhost:3000/api/appointments \
  -u customer@example.com:password123 \
  -F slotId=SLOT_ID \
  -F notes="First visit"
```

Book with an image or PDF attachment:

```bash
curl -X POST http://localhost:3000/api/appointments \
  -u customer@example.com:password123 \
  -F slotId=SLOT_ID \
  -F notes="Need wheelchair access" \
  -F attachment=@/absolute/path/to/supporting-document.pdf
```

Attachment rules:

- Allowed types: images (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`) and PDF (`.pdf`)
- Validation checks both MIME type and file extension
- Maximum size: 5MB
- Files are stored in private server storage and only exposed through the permissioned attachment retrieval route

Invalid file types and oversized files return `400 Bad Request`.

Reschedule:

```bash
curl -X PATCH http://localhost:3000/api/appointments/APPOINTMENT_ID \
  -u customer@example.com:password123 \
  -H "Content-Type: application/json" \
  -d '{"slotId":"NEW_SLOT_ID"}'
```

Update workflow status:

```bash
curl -X PATCH http://localhost:3000/api/appointments/APPOINTMENT_ID \
  -u staff1.mct-001@flowcare.com:password123 \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
```

## Branches

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/branches` | Public | Optional `isActive=true|false` |
| `POST` | `/api/branches` | Admin | Create branch |
| `GET` | `/api/branches/:id` | Any authenticated user with access | Staff/managers limited to own branch |
| `PATCH` | `/api/branches/:id` | Admin, Branch Manager | Managers limited to own branch |
| `DELETE` | `/api/branches/:id` | Admin | Delete branch |

Create branch:

```bash
curl -X POST http://localhost:3000/api/branches \
  -u admin@flowcare.com:YOUR_ADMIN_PASSWORD \
  -H "Content-Type: application/json" \
  -d '{"name":"Sohar Branch","code":"SHR-001","city":"Sohar","timezone":"Asia/Muscat"}'
```

## Service Types

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/service-types` | Public | Optional `branchId`, `isActive` |
| `POST` | `/api/service-types` | Admin, Branch Manager | Managers limited to own branch |
| `GET` | `/api/service-types/:id` | Any authenticated user with access | Branch-scoped for managers/staff |
| `PATCH` | `/api/service-types/:id` | Admin, Branch Manager | Branch-scoped |
| `DELETE` | `/api/service-types/:id` | Admin, Branch Manager | Branch-scoped |
| `GET` | `/api/service-types/:id/staff` | Admin, Branch Manager | List staff assigned to a service type at a branch; optional `branchId` filter |
| `POST` | `/api/service-types/:id/assign-staff` | Admin, Branch Manager | Assign staff to service type `{ staffId, branchId }`; idempotent on duplicate |
| `DELETE` | `/api/service-types/:id/assign-staff/:staffId` | Admin, Branch Manager | Remove staff from service type; optional `branchId` query param |

## Slots

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/slots` | Public | Filters: `branchId`, `serviceTypeId`, `startDate`, `endDate`, `available`; always excludes soft-deleted rows and ignores `includeDeleted` |
| `GET` | `/api/slots/branch-view` | Admin, Branch Manager, Staff | Internal listing; managers/staff are branch-scoped; soft-deleted rows stay hidden |
| `GET` | `/api/slots/admin-view` | Admin | Admin-only listing; `includeDeleted=true` includes soft-deleted rows |
| `POST` | `/api/slots` | Admin, Branch Manager | Create one slot from an object payload, or create multiple slots from an array payload |
| `POST` | `/api/slots/bulk` | Admin, Branch Manager | Create multiple slots from an array payload |
| `POST` | `/api/slots/cleanup-retention` | Admin | Hard-deletes only soft-deleted slots older than each branch's DB-backed retention window; idempotent on rerun |
| `GET` | `/api/slots/retention-preview` | Admin | Preview retention cleanup |
| `POST` | `/api/slots/:id/assign-staff` | Admin, Branch Manager | Explicitly assign a staff member to a slot; managers limited to own branch; staff must belong to the slot branch; duplicate assignment is idempotent |
| `GET` | `/api/slots/:id` | Any authenticated user with access | Admin can include deleted slots with `includeDeleted=true` |
| `PATCH` | `/api/slots/:id` | Admin, Branch Manager | Update slot |
| `DELETE` | `/api/slots/:id` | Admin, Branch Manager | Soft-delete slot |
| `DELETE` | `/api/slots/:id/assign-staff/:staffId` | Admin, Branch Manager | Explicitly remove a staff assignment from a slot; managers limited to own branch |
| `POST` | `/api/slots/:id/restore` | Admin | Restore soft-deleted slot |

Slot semantics:

- Each slot is one bookable unit.
- A second active booking on the same slot is rejected even if stored legacy data still has `capacity > 1`.
- Slot create and update requests only accept `capacity: 1`.

Create one slot:

```bash
curl -X POST http://localhost:3000/api/slots \
  -u admin@flowcare.com:YOUR_ADMIN_PASSWORD \
  -H "Content-Type: application/json" \
  -d '{"branchId":"BRANCH_ID","serviceTypeId":"SERVICE_TYPE_ID","startTime":"2026-03-10T09:00:00.000Z","endTime":"2026-03-10T09:15:00.000Z","capacity":1}'
```

Create multiple slots with `POST /api/slots/bulk`:

```bash
curl -X POST http://localhost:3000/api/slots/bulk \
  -u admin@flowcare.com:YOUR_ADMIN_PASSWORD \
  -H "Content-Type: application/json" \
  -d '[{"branchId":"BRANCH_ID","serviceTypeId":"SERVICE_TYPE_ID","startTime":"2026-03-10T09:00:00.000Z","endTime":"2026-03-10T09:15:00.000Z","capacity":1},{"branchId":"BRANCH_ID","serviceTypeId":"SERVICE_TYPE_ID","startTime":"2026-03-10T09:15:00.000Z","endTime":"2026-03-10T09:30:00.000Z","capacity":1}]'
```

Create multiple slots with an array payload on `POST /api/slots`:

```bash
curl -X POST http://localhost:3000/api/slots \
  -u admin@flowcare.com:YOUR_ADMIN_PASSWORD \
  -H "Content-Type: application/json" \
  -d '[{"branchId":"BRANCH_ID","serviceTypeId":"SERVICE_TYPE_ID","startTime":"2026-03-10T09:00:00.000Z","endTime":"2026-03-10T09:15:00.000Z","capacity":1},{"branchId":"BRANCH_ID","serviceTypeId":"SERVICE_TYPE_ID","startTime":"2026-03-10T09:15:00.000Z","endTime":"2026-03-10T09:30:00.000Z","capacity":1}]'
```

Cleanup example:

```bash
curl -X POST http://localhost:3000/api/slots/cleanup-retention \
  -u admin@flowcare.com:YOUR_ADMIN_PASSWORD
```

Retention cleanup behavior:

- Deletes only slots whose `deletedAt` is older than the effective branch retention window stored in the database
- Runs inside a Prisma transaction with `Serializable` isolation
- Deletes related `SlotAssignment` rows before removing the slot
- Sets related `Appointment.slotId` references to `null` so historical appointments remain available
- Preserves prior `SLOT_DELETED` audit rows and writes one new `SLOT_HARD_DELETED` audit row per hard-deleted slot
- A second run is a no-op when no additional slots have become eligible

Assign staff to a slot:

```bash
curl -X POST http://localhost:3000/api/slots/SLOT_ID/assign-staff \
  -u admin@flowcare.com:YOUR_ADMIN_PASSWORD \
  -H "Content-Type: application/json" \
  -d '{"staffId":"STAFF_ID"}'
```

Remove staff from a slot:

```bash
curl -X DELETE http://localhost:3000/api/slots/SLOT_ID/assign-staff/STAFF_ID \
  -u manager.mct-001@flowcare.com:password123
```

Staff assignment operates at two levels: **slot-level** (`SlotAssignment` records via `/api/slots/:id/assign-staff`) and **service-type-level** (`StaffServiceAssignment` records via `/api/service-types/:id/assign-staff`). Slot assignments tie a staff member to a concrete slot. Service-type assignments declare which services a staff member can handle at a given branch.

## Staff

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/staff/me` | Admin, Branch Manager, Staff | Staff self-lookup (own profile) |
| `GET` | `/api/staff` | Admin, Branch Manager | Managers branch-scoped; staff cannot list directory |
| `POST` | `/api/staff` | Admin, Branch Manager | Managers limited to own branch |
| `GET` | `/api/staff/:id` | Admin, Branch Manager | Branch-scoped; staff cannot look up other staff |
| `PATCH` | `/api/staff/:id` | Admin, Branch Manager | Branch-scoped |
| `DELETE` | `/api/staff/:id` | Admin, Branch Manager | Branch-scoped |

## Customers

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/customers` | Admin, Branch Manager | Staff cannot browse customer directory |
| `POST` | `/api/customers` | Any authenticated user | Create customer profile |
| `GET` | `/api/customers/:id` | Admin, Branch Manager, Customer (own) | Staff cannot look up customers |
| `PATCH` | `/api/customers/:id` | Any authenticated user with access | Scoped by role |

## Uploads and Private Files

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/files/customer-id/:customerId` | Admin | Retrieve stored customer ID image |
| `GET` | `/api/files/appointment/:appointmentId/attachment` | Any authenticated user with access | Customer owns appointment, or branch staff/manager, or admin |
| `POST` | `/api/uploads/appointment-attachment` | Any authenticated user with access | Legacy helper route; supported, but `POST /api/appointments` is the primary contract for booking with an attachment |

Legacy helper upload example:

```bash
curl -X POST http://localhost:3000/api/uploads/appointment-attachment \
  -u customer@example.com:password123 \
  -F appointmentId=APPOINTMENT_ID \
  -F appointmentAttachment=@/absolute/path/to/supporting-document.pdf
```

## Audit

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/audit` | Admin, Branch Manager | Managers see only their branch logs |
| `GET` | `/api/audit/export` | Admin | CSV export |

Each audit record includes an `actorRole` field that snapshots the role of the user who performed the action at the time it occurred. The CSV export includes `actorRole` as a dedicated column.

Audit export:

```bash
curl -u admin@flowcare.com:YOUR_ADMIN_PASSWORD \
  http://localhost:3000/api/audit/export \
  -o audit-logs.csv
```

## Retention Configuration

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/retention-config` | Admin | Optional `branchId`; default effective retention is 30 days |
| `PUT` | `/api/retention-config` | Admin | Upserts `{ branchId, retentionDays }` |

Example:

```bash
curl -X PUT http://localhost:3000/api/retention-config \
  -u admin@flowcare.com:YOUR_ADMIN_PASSWORD \
  -H "Content-Type: application/json" \
  -d '{"branchId":"BRANCH_ID","retentionDays":45}'
```
