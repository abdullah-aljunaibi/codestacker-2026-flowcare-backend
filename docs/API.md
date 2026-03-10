# API Reference

Base URL: `http://localhost:3000`

Protected routes use HTTP Basic Auth:

```bash
curl -u admin@flowcare.com:admin123 http://localhost:3000/api/audit
```

Appointment statuses exposed by the API are `WAITING`, `SERVING`, `DONE`, `CANCELLED`, and `NO_SHOW`.

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
| `POST` | `/api/auth/login` | Public | Validate Basic Auth credentials and record login attempt |

Example login:

```bash
curl -X POST -u admin@flowcare.com:admin123 http://localhost:3000/api/auth/login
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
| `GET` | `/api/appointments` | Any authenticated user | Customers see own, staff/managers see branch, admin sees all |
| `POST` | `/api/appointments` | Customer, Staff, Branch Manager, Admin | Books appointment; validates slot capacity and duplicate bookings |
| `GET` | `/api/appointments/:id` | Scoped | Customers own only; staff/manager branch scoped |
| `PATCH` | `/api/appointments/:id` | Scoped | Reschedule with `slotId`, update notes, or update status |
| `DELETE` | `/api/appointments/:id` | Scoped | Soft-cancel appointment record |

Book:

```bash
curl -X POST http://localhost:3000/api/appointments \
  -u customer@example.com:password123 \
  -H "Content-Type: application/json" \
  -d '{"slotId":"SLOT_ID","notes":"First visit"}'
```

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
  -d '{"status":"DONE"}'
```

## Branches

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/branches` | Public | Optional `isActive=true|false` |
| `POST` | `/api/branches` | Admin | Create branch |
| `GET` | `/api/branches/:id` | Authenticated | Staff/managers limited to own branch |
| `PATCH` | `/api/branches/:id` | Admin, Branch Manager | Managers limited to own branch |
| `DELETE` | `/api/branches/:id` | Admin | Delete branch |

Create branch:

```bash
curl -X POST http://localhost:3000/api/branches \
  -u admin@flowcare.com:admin123 \
  -H "Content-Type: application/json" \
  -d '{"name":"Sohar Branch","code":"SHR-001","city":"Sohar","timezone":"Asia/Muscat"}'
```

## Service Types

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/service-types` | Public | Optional `branchId`, `isActive` |
| `POST` | `/api/service-types` | Admin, Branch Manager | Managers limited to own branch |
| `GET` | `/api/service-types/:id` | Authenticated | Branch-scoped for managers/staff |
| `PATCH` | `/api/service-types/:id` | Admin, Branch Manager | Branch-scoped |
| `DELETE` | `/api/service-types/:id` | Admin, Branch Manager | Branch-scoped |

## Slots

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/slots` | Public | Filters: `branchId`, `serviceTypeId`, `startDate`, `endDate`, `available`; always excludes soft-deleted rows and ignores `includeDeleted` |
| `GET` | `/api/slots/branch-view` | Admin, Branch Manager, Staff | Internal listing; managers/staff are branch-scoped; soft-deleted rows stay hidden |
| `GET` | `/api/slots/admin-view` | Admin | Admin-only listing; `includeDeleted=true` includes soft-deleted rows |
| `POST` | `/api/slots` | Admin, Branch Manager | Create slot |
| `POST` | `/api/slots/cleanup-retention` | Admin | Deletes soft-deleted slots based on DB retention config |
| `GET` | `/api/slots/retention-preview` | Admin | Preview retention cleanup |
| `POST` | `/api/slots/:id/assign-staff` | Admin, Branch Manager | Explicitly assign a staff member to a slot; managers limited to own branch; staff must belong to the slot branch; duplicate assignment is idempotent |
| `GET` | `/api/slots/:id` | Authenticated | Admin can include deleted slots with `includeDeleted=true` |
| `PATCH` | `/api/slots/:id` | Admin, Branch Manager | Update slot |
| `DELETE` | `/api/slots/:id` | Admin, Branch Manager | Soft-delete slot |
| `DELETE` | `/api/slots/:id/assign-staff/:staffId` | Admin, Branch Manager | Explicitly remove a staff assignment from a slot; managers limited to own branch |
| `POST` | `/api/slots/:id/restore` | Admin | Restore soft-deleted slot |

Cleanup example:

```bash
curl -X POST http://localhost:3000/api/slots/cleanup-retention \
  -u admin@flowcare.com:admin123
```

Assign staff to a slot:

```bash
curl -X POST http://localhost:3000/api/slots/SLOT_ID/assign-staff \
  -u admin@flowcare.com:admin123 \
  -H "Content-Type: application/json" \
  -d '{"staffId":"STAFF_ID"}'
```

Remove staff from a slot:

```bash
curl -X DELETE http://localhost:3000/api/slots/SLOT_ID/assign-staff/STAFF_ID \
  -u manager.mct-001@flowcare.com:password123
```

Staff assignment scope is slot-level only. The API stores assignments in `SlotAssignment` records tied to a concrete slot, and appointment booking validates against those slot assignments. There is no separate service-level staff assignment API.

## Staff

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/staff` | Admin, Branch Manager, Staff | Managers/staff branch scoped |
| `POST` | `/api/staff` | Admin, Branch Manager | Managers limited to own branch |
| `GET` | `/api/staff/:id` | Admin, Branch Manager, Staff | Branch-scoped |
| `PATCH` | `/api/staff/:id` | Admin, Branch Manager | Branch-scoped |
| `DELETE` | `/api/staff/:id` | Admin, Branch Manager | Branch-scoped |

## Customers

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/customers` | Authenticated | Customers see own profile; staff/managers see branch-related customers |
| `POST` | `/api/customers` | Authenticated | Create customer profile |
| `GET` | `/api/customers/:id` | Authenticated | Scoped by role |
| `PATCH` | `/api/customers/:id` | Authenticated | Scoped by role |

## Uploads and Private Files

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/files/customer-id/:customerId` | Admin | Retrieve stored customer ID image |
| `GET` | `/api/files/appointment/:appointmentId/attachment` | Scoped | Customer owns appointment, or branch staff/manager, or admin |
| `POST` | `/api/uploads/appointment-attachment` | Scoped | Multipart field: `appointmentAttachment` |

Upload appointment attachment:

```bash
curl -X POST http://localhost:3000/api/uploads/appointment-attachment \
  -u customer@example.com:password123 \
  -F appointmentId=APPOINTMENT_ID \
  -F appointmentAttachment=@/absolute/path/to/document.pdf
```

## Audit

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/audit` | Admin, Branch Manager | Managers see only their branch logs |
| `GET` | `/api/audit/export` | Admin | CSV export |

Audit export:

```bash
curl -u admin@flowcare.com:admin123 \
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
  -u admin@flowcare.com:admin123 \
  -H "Content-Type: application/json" \
  -d '{"branchId":"BRANCH_ID","retentionDays":45}'
```

## Queue

The queue endpoints are present but currently return `501 Not Implemented`:

| Method | Path |
| --- | --- |
| `GET` | `/api/queue/status` |
| `POST` | `/api/queue/join` |
| `GET` | `/api/queue/my-status` |
| `POST` | `/api/queue/leave` |
