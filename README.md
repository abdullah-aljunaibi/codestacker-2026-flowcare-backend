# FlowCare Queue & Appointment Booking System

Backend API for FlowCare's queue and appointment booking platform — built for the Rihal Codestacker 2026 Backend Challenge.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL 16
- **ORM:** Prisma 6
- **Auth:** JWT (Bearer tokens)
- **File Storage:** Local filesystem
- **Build:** esbuild

## Setup Instructions

### Prerequisites

- Node.js 18+
- PostgreSQL 16 (or Docker)
- Git

### 1. Clone & Install

```bash
git clone https://github.com/abdullah-aljunaibi/codestacker-2026-flowcare-backend.git
cd codestacker-2026-flowcare-backend
npm install
```

### 2. Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/flowcare?schema=public"
JWT_SECRET="your-secret-key-change-in-production"
PORT=3000
```

### 3. Start PostgreSQL

Using Docker:

```bash
docker run --name flowcare-db -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres:16
```

Or use an existing PostgreSQL instance and update `DATABASE_URL` accordingly.

### 4. Run Migrations

```bash
npx prisma migrate deploy
```

### 5. Seed the Database

```bash
npm run db:seed
```

Seeding is **idempotent** — running it multiple times will not duplicate data.

Seed creates:
- 1 Admin user
- 2 Branches (Muscat, Salalah)
- 2 Branch Managers
- 6 Service Types (3 per branch)
- 6 Staff members (3 per branch)
- 5 Customers
- 144 Time Slots (next 3 days)
- 1 Sample Appointment

**Default password for all users:** `password123`

### 6. Build & Start

```bash
npm run build
npm start
```

Server starts at `http://localhost:3000` (or the port specified in `.env`).

---

## API Documentation

### Health Check

```bash
curl http://localhost:3000/health
```

---

### Public Endpoints (No Authentication)

#### List Branches

```bash
curl http://localhost:3000/api/branches
```

#### List Service Types

```bash
# All service types
curl http://localhost:3000/api/service-types

# Filter by branch
curl "http://localhost:3000/api/service-types?branchId=BRANCH_ID"
```

#### List Available Slots

```bash
# All slots
curl http://localhost:3000/api/slots

# Filter by branch, service type, and date
curl "http://localhost:3000/api/slots?branchId=BRANCH_ID&serviceTypeId=SERVICE_TYPE_ID&date=2026-03-10"
```

---

### Authentication

#### Register Customer

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe",
    "role": "CUSTOMER"
  }'
```

A Customer profile is automatically created during registration.

#### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@flowcare.com",
    "password": "password123"
  }'
```

Returns a JWT token. Use it in subsequent requests:

```
Authorization: Bearer <token>
```

---

### Customer Endpoints (Authenticated)

#### Book Appointment

```bash
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "slotId": "SLOT_ID",
    "branchId": "BRANCH_ID",
    "serviceTypeId": "SERVICE_TYPE_ID",
    "notes": "First visit"
  }'
```

`customerId` is auto-filled from the JWT token for customers.

#### List My Appointments

```bash
curl http://localhost:3000/api/appointments \
  -H "Authorization: Bearer $TOKEN"
```

#### Cancel Appointment

```bash
curl -X DELETE http://localhost:3000/api/appointments/APPOINTMENT_ID \
  -H "Authorization: Bearer $TOKEN"
```

#### Reschedule Appointment

```bash
curl -X PATCH http://localhost:3000/api/appointments/APPOINTMENT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"slotId": "NEW_SLOT_ID"}'
```

---

### Staff Endpoints (Authenticated)

#### Update Appointment Status

```bash
curl -X PATCH http://localhost:3000/api/appointments/APPOINTMENT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"status": "CHECKED_IN"}'
```

Supported statuses: `SCHEDULED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`

---

### Admin / Manager Endpoints (Authenticated)

#### Create Slot

```bash
curl -X POST http://localhost:3000/api/slots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "branchId": "BRANCH_ID",
    "serviceTypeId": "SERVICE_TYPE_ID",
    "startTime": "2026-03-15T09:00:00Z",
    "endTime": "2026-03-15T10:00:00Z",
    "capacity": 1
  }'
```

#### Soft Delete Slot

```bash
curl -X DELETE http://localhost:3000/api/slots/SLOT_ID \
  -H "Authorization: Bearer $TOKEN"
```

#### Restore Soft-Deleted Slot

```bash
curl -X POST http://localhost:3000/api/slots/SLOT_ID/restore \
  -H "Authorization: Bearer $TOKEN"
```

#### Retention Preview

```bash
curl "http://localhost:3000/api/slots/retention-preview?days=30" \
  -H "Authorization: Bearer $TOKEN"
```

#### Retention Cleanup (Hard Delete)

```bash
curl -X POST "http://localhost:3000/api/slots/cleanup-retention?days=30" \
  -H "Authorization: Bearer $TOKEN"
```

#### View Audit Logs

```bash
curl http://localhost:3000/api/audit \
  -H "Authorization: Bearer $TOKEN"
```

#### Export Audit Logs as CSV

```bash
curl http://localhost:3000/api/audit/export \
  -H "Authorization: Bearer $TOKEN" \
  -o audit-logs.csv
```

---

### File Upload & Retrieval

#### Upload Customer ID Image

```bash
curl -X POST http://localhost:3000/api/uploads/customer-id \
  -H "Authorization: Bearer $TOKEN" \
  -F "customerIdImage=@/path/to/id-photo.jpg"
```

#### Upload Appointment Attachment

```bash
curl -X POST http://localhost:3000/api/uploads/appointment-attachment \
  -H "Authorization: Bearer $TOKEN" \
  -F "appointmentAttachment=@/path/to/document.pdf" \
  -F "appointmentId=APPOINTMENT_ID"
```

#### Retrieve Customer ID Image (Admin Only)

```bash
curl http://localhost:3000/api/files/customer-id/CUSTOMER_ID \
  -H "Authorization: Bearer $TOKEN"
```

#### Retrieve Appointment Attachment

```bash
curl http://localhost:3000/api/files/appointment/APPOINTMENT_ID/attachment \
  -H "Authorization: Bearer $TOKEN"
```

---

## Roles & Permissions

| Role | Scope | Key Permissions |
|------|-------|----------------|
| **Admin** | System-wide | Full access to all branches, slots, appointments, audit logs, file retrieval |
| **Branch Manager** | Branch-scoped | Manage slots, staff, appointments within assigned branch |
| **Staff** | Branch-scoped | View schedule, update appointment status |
| **Customer** | Own data | Book/cancel/reschedule own appointments, upload files |

---

## Database Schema

### Models

- **User** — Authentication, roles (ADMIN, BRANCH_MANAGER, STAFF, CUSTOMER)
- **Customer** — Customer profile, ID image reference
- **Staff** — Staff profile, branch assignment
- **Branch** — Service locations
- **ServiceType** — Services offered per branch
- **Slot** — Available time slots with soft delete support
- **SlotAssignment** — Staff-to-slot assignments
- **Appointment** — Bookings with status tracking
- **AuditLog** — Action audit trail

### ERD

Run `npx prisma studio` to explore the schema visually.

---

## Project Structure

```
src/
├── index.ts              # Express app setup, route mounting
├── middleware/
│   └── auth.ts           # JWT auth, role, ownership middleware
├── routes/
│   ├── auth.ts           # Register, login
│   ├── branches.ts       # Branch CRUD
│   ├── service-types.ts  # Service type CRUD
│   ├── slots.ts          # Slot CRUD, soft delete, retention
│   ├── appointments.ts   # Booking, cancel, reschedule
│   ├── staff.ts          # Staff management
│   ├── customers.ts      # Customer management
│   ├── audit.ts          # Audit logs + CSV export
│   ├── uploads.ts        # File upload + retrieval
│   └── queue.ts          # Queue endpoints (placeholder)
├── types/
│   └── index.ts          # Zod schemas, TypeScript types
└── utils/
    ├── jwt.ts            # Token generation/verification
    └── audit-logger.ts   # Audit logging utility
prisma/
├── schema.prisma         # Database schema
├── seed.ts               # Idempotent seed script
└── migrations/           # Database migrations
```

---

## Seed Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@flowcare.com | password123 |
| Branch Manager (Muscat) | manager.mct-001@flowcare.com | password123 |
| Branch Manager (Salalah) | manager.sll-001@flowcare.com | password123 |
| Staff | staff1.mct-001@flowcare.com | password123 |
| Customer | customer1@example.com | password123 |

---

## Author

Abdullah Al Junaibi — Rihal Codestacker 2026
