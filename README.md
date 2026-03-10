# FlowCare Backend

Node.js/Express/Prisma backend for the FlowCare queue and appointment booking system.

## Project Overview

This service manages:

- branch and service discovery
- customer registration with ID image upload
- appointment booking, rescheduling, cancellation, and staff workflow updates
- explicit slot-level staff assignment and unassignment endpoints
- branch-scoped staff and manager access control
- slot soft-delete and retention cleanup
- audit logging and CSV export

Protected routes use HTTP Basic Authentication. Startup bootstrapping imports `prisma/seed-data.json` idempotently and guarantees a default admin user exists.

## Stack

- Node.js + TypeScript
- Express
- Prisma ORM
- PostgreSQL
- Local filesystem uploads
- esbuild for production bundling

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env`:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/flowcare?schema=public"
PORT=3000
ALLOWED_ORIGINS=http://localhost:3000
```

3. Apply schema:

```bash
npx prisma migrate deploy
```

4. Start the API in development mode:

```bash
npm run dev
```

The app bootstraps seed data automatically on startup. You can also regenerate Prisma Client manually with `npx prisma generate`.

## Default Admin Credentials

- Email: `admin@flowcare.com`
- Password: `admin123`

## Basic Authentication

Use curl's `-u` flag on protected routes:

```bash
curl -u admin@flowcare.com:admin123 http://localhost:3000/api/audit
```

You can also validate credentials explicitly:

```bash
curl -X POST -u admin@flowcare.com:admin123 http://localhost:3000/api/auth/login
```

## API Quick Examples

Health check:

```bash
curl http://localhost:3000/health
```

Register a customer with an ID image:

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

List public branches:

```bash
curl http://localhost:3000/api/branches
```

List public slots for a branch and service:

```bash
curl "http://localhost:3000/api/slots?branchId=BRANCH_ID&serviceTypeId=SERVICE_TYPE_ID&available=true"
```

List internal branch-scoped slots as manager or staff:

```bash
curl -u manager.mct-001@flowcare.com:password123 \
  "http://localhost:3000/api/slots/branch-view?branchId=BRANCH_ID"
```

List admin slots including soft-deleted rows:

```bash
curl -u admin@flowcare.com:admin123 \
  "http://localhost:3000/api/slots/admin-view?includeDeleted=true"
```

Book an appointment with an optional attachment on the same route:

```bash
curl -X POST http://localhost:3000/api/appointments \
  -u customer@example.com:password123 \
  -F slotId=SLOT_ID \
  -F notes="First visit" \
  -F attachment=@/absolute/path/to/supporting-document.pdf
```

Book an appointment without an attachment:

```bash
curl -X POST http://localhost:3000/api/appointments \
  -u customer@example.com:password123 \
  -F slotId=SLOT_ID \
  -F notes="First visit"
```

Reschedule an appointment:

```bash
curl -X PATCH http://localhost:3000/api/appointments/APPOINTMENT_ID \
  -u customer@example.com:password123 \
  -H "Content-Type: application/json" \
  -d '{"slotId":"NEW_SLOT_ID"}'
```

Update workflow status as assigned staff:

```bash
curl -X PATCH http://localhost:3000/api/appointments/APPOINTMENT_ID \
  -u staff1.mct-001@flowcare.com:password123 \
  -H "Content-Type: application/json" \
  -d '{"status":"SERVING"}'
```

Upload or replace an attachment on an existing appointment with the legacy helper route:

```bash
curl -X POST http://localhost:3000/api/uploads/appointment-attachment \
  -u customer@example.com:password123 \
  -F appointmentId=APPOINTMENT_ID \
  -F appointmentAttachment=@/absolute/path/to/supporting-document.pdf
```

Set branch retention configuration as admin:

```bash
curl -X PUT http://localhost:3000/api/retention-config \
  -u admin@flowcare.com:admin123 \
  -H "Content-Type: application/json" \
  -d '{"branchId":"BRANCH_ID","retentionDays":45}'
```

Run retention cleanup:

```bash
curl -X POST http://localhost:3000/api/slots/cleanup-retention \
  -u admin@flowcare.com:admin123
```

Retention cleanup is relation-safe and idempotent. It only hard-deletes slots whose `deletedAt` is older than the effective DB-backed retention window, removes related `SlotAssignment` rows, nulls `Appointment.slotId` for historical appointments, preserves prior soft-delete audit rows, and records a `SLOT_HARD_DELETED` audit event for each deleted slot. Running it again immediately is a no-op.

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

Export audit logs:

```bash
curl -u admin@flowcare.com:admin123 \
  http://localhost:3000/api/audit/export \
  -o audit-logs.csv
```

`POST /api/appointments` accepts `multipart/form-data` as the primary booking contract. Text fields arrive in `req.body`, and the optional `attachment` file arrives in `req.file`. Files are validated for image/PDF type, size-limited to 5MB, stored in private storage, and retrieved through the permissioned file route only.

Full endpoint documentation is in `docs/API.md`.

## Error Response Format

All JSON errors use this shape:

```json
{
  "success": false,
  "error": "Human readable message",
  "details": []
}
```

`details` is optional and only included for validation-style failures.

## Architecture Overview

- `src/index.ts`: Express bootstrap, route registration, startup seed import, global handlers
- `src/middleware/auth.ts`: Basic Authentication parsing, authentication, and RBAC helpers
- `src/routes/*`: Route modules grouped by domain
- `src/utils/audit-logger.ts`: audit trail writes with branch-aware context
- `src/utils/retention-config.ts`: DB-backed retention resolution
- `src/bootstrap/seed.ts`: idempotent startup bootstrap from `prisma/seed-data.json`
- `prisma/schema.prisma`: relational schema
- `prisma/migrations/*`: deployable SQL migrations when present in the repository snapshot

Staff assignment is slot-level only. A `SlotAssignment` links a staff member to one concrete slot; service types do not have separate assignment records.

## Verification

These commands pass in the current repository state:

```bash
npx tsc --noEmit
npm run build
```
