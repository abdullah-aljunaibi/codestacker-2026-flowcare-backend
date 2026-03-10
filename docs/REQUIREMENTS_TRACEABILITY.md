# FlowCare Requirements Traceability Matrix

Source of truth: `~/.openclaw/workspace/knowledge/flowcare-master-prompt.md`  
Assessment basis: static inspection of the current repository on 2026-03-10.

## Master Matrix

| requirement_id | exact_requirement_text | category | priority | hidden_constraints | current_status | implementation_files | verification_method | evidence | notes |
|---|---|---|---|---|---|---|---|---|---|
| FC-MUST-001 | Basic Authentication is required | auth | must | Anti-spec drift forbids JWT as a replacement for required Basic Auth | missing | `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/utils/jwt.ts`, `README.md` | Inspect auth middleware and login contract | `src/middleware/auth.ts:22-43` expects `Bearer`; `src/routes/auth.ts:74-87` and `154-175` mint/return JWT; `README.md` declares `JWT (Bearer tokens)` | CRITICAL VIOLATION. Current implementation is JWT-based, not Basic Auth. |
| FC-MUST-002 | The system must start with a default Admin user | auth | must | Must exist at startup, not only after a manual seed command | partial | `prisma/seed.ts`, `src/index.ts` | Inspect bootstrap path and seed behavior | `prisma/seed.ts:36-47` creates admin; `src/index.ts:82-87` starts server without seeding | Admin creation exists only inside manual seed script. |
| FC-MUST-003 | All APIs are protected except explicitly public endpoints | auth | must | Public endpoints are the listed public contract only; protection must use the required auth mechanism | partial | `src/index.ts`, `src/routes/appointments.ts`, `src/routes/uploads.ts`, `src/routes/branches.ts`, `src/routes/service-types.ts`, `src/routes/slots.ts` | Inspect route-level middleware | Protected route groups use `authMiddleware` (`src/routes/appointments.ts:10-11`, `src/routes/uploads.ts:13-14`), while public GETs exist for branches/services/slots (`src/routes/branches.ts:11-66`, `src/routes/service-types.ts:11-73`, `src/routes/slots.ts:12-113`) | Route protection pattern is mostly present, but the auth mechanism itself is non-compliant because it is JWT. |
| FC-MUST-004 | Required entities: Branch, ServiceType, Slot, Staff, Customer, Appointment, AuditLog | rbac | must | Schema must materially model all required entities | satisfied | `prisma/schema.prisma` | Inspect Prisma schema | `prisma/schema.prisma:43-230` defines all required models | Core entity coverage exists. |
| FC-MUST-005 | Customer registration must include storing the required image of customer's ID | registration | must | Forbidden substitution: a separate upload endpoint is not a replacement for required ID-image upload during registration | missing | `src/routes/auth.ts`, `src/routes/uploads.ts`, `src/types/index.ts` | Inspect registration payload and upload flow | `src/routes/auth.ts:10-88` accepts JSON only; `src/types/index.ts:7-14` register schema has no file field; ID upload is separate at `src/routes/uploads.ts:202-321` | CRITICAL VIOLATION. Registration is not inline with ID-image upload. |
| FC-MUST-006 | Login must support the required authentication contract | auth | must | Must match Basic Auth contract, not a token issuance flow | missing | `src/routes/auth.ts`, `src/middleware/auth.ts` | Inspect login and downstream auth usage | `src/routes/auth.ts:98-175` returns a JWT token; `src/middleware/auth.ts:32-40` requires `Authorization: Bearer` | Login contract is wrong for the challenge. |
| FC-MUST-007 | Customers can book, cancel, reschedule, and view their own appointments | registration | must | Must cover all four actions without requiring privileged help | partial | `src/routes/appointments.ts`, `src/middleware/auth.ts`, `src/types/index.ts` | Inspect appointment CRUD and ownership rules | Own-view works via `ownershipMiddleware` and customer scoping (`src/routes/appointments.ts:17-135`, `330-424`); booking exists (`137-328`); cancel exists via PATCH/DELETE (`426-520` and later delete route); `src/types/index.ts:143-149` has no `slotId` on update, so reschedule is absent | Reschedule capability is missing from the current PATCH schema/handler. |
| FC-MUST-008 | Staff and managers have branch-scoped visibility and status update powers | rbac | must | No cross-branch leakage; scope must be enforced on reads and writes | partial | `src/middleware/auth.ts`, `src/routes/appointments.ts`, `src/routes/staff.ts`, `src/routes/slots.ts` | Inspect branch scoping and appointment status logic | Branch-scoped middleware exists (`src/middleware/auth.ts:111-179`); appointment list/status update exists (`src/routes/appointments.ts:13-18`, `34-38`, `426-520`) | Core pattern exists, but staff schedule is not clearly modeled as assigned-only schedule, and the auth contract remains non-compliant. |
| FC-MUST-009 | Seed data must import from the provided JSON file | seed | must | Forbidden substitution: hard-coded seed objects are not a replacement for reading the provided challenge JSON file | missing | `prisma/seed.ts` | Inspect seed source | `prisma/seed.ts:6-220` constructs data inline in TypeScript; no JSON import exists anywhere under `prisma/` | Direct contract miss. |
| FC-MUST-010 | Seed import must happen at startup | seed | must | Forbidden substitution: a manual seed command is not a replacement for required startup import | missing | `src/index.ts`, `README.md`, `package.json` | Inspect startup path and docs | `src/index.ts:82-87` only starts Express; `README.md` instructs manual `npm run db:seed` | Direct contract miss. |
| FC-MUST-011 | Seed behavior must be idempotent | seed | must | Forbidden substitution: destructive reset seeding is not idempotent import | missing | `prisma/seed.ts` | Inspect seed semantics | `prisma/seed.ts:19-29` deletes all domain data before recreating it | Current seed is destructive reset, not convergent import. |
| FC-MUST-012 | Slot removal must be soft delete | deletion | must | Normal consumer listings must hide soft-deleted slots | satisfied | `prisma/schema.prisma`, `src/routes/slots.ts` | Inspect schema and delete path | `prisma/schema.prisma:131-155` has `deletedAt`; `src/routes/slots.ts:710-799` sets `deletedAt`; `src/routes/slots.ts:53-57` excludes deleted slots by default | Core soft-delete behavior exists. |
| FC-MUST-013 | Retention period must be a number-of-days value stored in the database | deletion | must | Forbidden substitution: query params or env vars are not replacements for DB-backed retention configuration | missing | `prisma/schema.prisma`, `src/routes/slots.ts` | Inspect schema for config model/field and cleanup implementation | No retention config model exists in `prisma/schema.prisma:15-230`; cleanup reads `req.query.days` in `src/routes/slots.ts:242-258` | CRITICAL VIOLATION. Retention is request-driven, not DB-backed. |
| FC-MUST-014 | Only admins can configure retention days | deletion | must | Requires an admin-only configuration pathway backed by DB state | missing | `src/routes/slots.ts`, `prisma/schema.prisma` | Inspect for retention settings API/model | Cleanup is admin-only, but there is no persisted retention setting to configure anywhere | Missing feature, not just missing authorization. |
| FC-MUST-015 | Cleanup of expired soft-deleted slots must be idempotent | deletion | must | Must operate against DB-backed retention and remain safe on rerun | partial | `src/routes/slots.ts` | Inspect cleanup semantics | Cleanup only targets old soft-deleted slots and is rerunnable (`src/routes/slots.ts:242-348`), but retention source is query-param based rather than DB-backed | Mechanically rerunnable, contractually incomplete. |
| FC-MUST-016 | Audit logs must capture sensitive actions with required fields | audit | must | Must cover required actions and include user/action/entity/entityId/branch context/IP/metadata as needed | partial | `prisma/schema.prisma`, `src/utils/audit-logger.ts`, `src/routes/appointments.ts`, `src/routes/slots.ts`, `src/routes/uploads.ts` | Inspect schema and audit call sites | Schema supports required fields (`prisma/schema.prisma:212-230`); audit calls exist for appointment/slot/upload flows (`src/routes/appointments.ts:300-314`, `src/routes/slots.ts:211-225`, `779-790`, `src/routes/uploads.ts:68-79`, `175-186`, `288-301`, `404-417`) | Coverage is incomplete: login/auth events, seed/bootstrap actions, branch/service mutations, and retention configuration are not comprehensively audited. |
| FC-MUST-017 | Admin can view/export all audit logs | audit | must | Export should be system-wide | satisfied | `src/routes/audit.ts` | Inspect audit routes | Admin list and CSV export exist in `src/routes/audit.ts:12-119` and `121-196` | Meets current contract at code level. |
| FC-MUST-018 | Manager can view branch-only audit logs | audit | must | Must not allow cross-branch audit visibility | satisfied | `src/routes/audit.ts`, `src/middleware/auth.ts` | Inspect branch filter for manager role | `src/routes/audit.ts:57-69` forces `where.branchId = req.user.branchId` for `BRANCH_MANAGER` | Branch-only audit visibility is implemented. |
| FC-MUST-019 | Customer ID retrieval must be admin-only | registration | must | Must also avoid public/static exposure | satisfied | `src/routes/uploads.ts`, `src/index.ts` | Inspect file retrieval route and static serving | `src/routes/uploads.ts:17-93` restricts to `ADMIN`; `src/index.ts:31-32` notes static `/uploads` serving was removed | Meets current contract at code level. |
| FC-MUST-020 | Appointment attachment retrieval must enforce permissions and content-type | registration | must | Must enforce role/ownership and return proper content-type | satisfied | `src/routes/uploads.ts` | Inspect permission checks and response headers | Permission checks at `src/routes/uploads.ts:137-157`; content-type set at `188-190` | Meets current contract at code level. |
| FC-SHOULD-001 | Public endpoints for branches, services by branch, and available slots | slots | should | Public contract should still expose the required filter shape cleanly | partial | `src/routes/branches.ts`, `src/routes/service-types.ts`, `src/routes/slots.ts` | Inspect unauthenticated GET routes and supported filters | Public GETs exist in `src/routes/branches.ts:11-66`, `src/routes/service-types.ts:11-73`, `src/routes/slots.ts:12-113`; slot filtering uses `startDate/endDate`, not the documented `date` query | Public access exists, but the available-slot filter contract is not cleanly aligned. |
| FC-SHOULD-002 | staff can view assigned appointments/schedule | rbac | should | “Assigned” should mean assignment-aware, not merely branch-wide visibility | partial | `src/routes/appointments.ts`, `src/routes/staff.ts`, `prisma/schema.prisma` | Inspect schedule-related endpoints and assignment model usage | Staff can view branch appointments (`src/routes/appointments.ts:34-38`), and `SlotAssignment` exists in schema (`prisma/schema.prisma:157-170`), but there is no dedicated assigned-schedule endpoint using slot assignments | Branch visibility exists; assigned-schedule behavior is weak. |
| FC-SHOULD-003 | manager can manage only assigned branch data | rbac | should | Must consistently prevent cross-branch writes | satisfied | `src/middleware/auth.ts`, `src/routes/branches.ts`, `src/routes/service-types.ts`, `src/routes/slots.ts`, `src/routes/staff.ts` | Inspect branch-scoped write routes | `branchScopedMiddleware` enforces branch context (`src/middleware/auth.ts:118-179`); manager write routes also re-check branch IDs, e.g. slots `134-163`, staff `107-123`, branch update `220-247` | Protected branch-management paths are correctly scoped. |
| FC-SHOULD-004 | admin can manage all branches | rbac | should | Admin should not be branch-restricted | satisfied | `src/middleware/auth.ts`, `src/routes/branches.ts`, `src/routes/service-types.ts`, `src/routes/slots.ts`, `src/routes/staff.ts` | Inspect admin bypass behavior on management routes | `src/middleware/auth.ts:128-139` explicitly allows admin bypass; admin-only branch creation exists at `src/routes/branches.ts:68-119` | Current branch-management paths allow system-wide admin control. |
| FC-SHOULD-005 | README, env vars, migrations, and example API usage are accurate | bonus | should | Docs must not claim non-compliant behavior as complete; migrations must exist | partial | `README.md`, `prisma/`, `src/routes/auth.ts`, `src/middleware/auth.ts` | Inspect README against code and repo contents | README documents JWT/Bearer and manual seed (`README.md:11`, `37`, `60`, `157-160`); `prisma/` contains no `migrations/` directory | Docs exist, but they are not challenge-accurate and migrations are absent. |
| FC-BONUS-001 | Potential: pagination+search, queue position, rate limiting, background cleanup cron, Docker+docker-compose, deployment guide, automated tests/OpenAPI/Postman collection. | queue | bonus | Bonus work is only relevant after all required items pass | missing | `src/routes/queue.ts`, repository root | Inspect queue endpoints and bonus assets | `src/routes/queue.ts:1-58` is entirely `501 Not implemented`; no OpenAPI/Postman/test bonus assets were found | Bonus work is not started, which is appropriate until required gaps are closed. |

## MUST Requirements

Priority `must` rows: `FC-MUST-001` through `FC-MUST-020`.

Highest-risk MUST gaps:

- `FC-MUST-001` and `FC-MUST-006`: auth contract is wrong. The system is built around JWT bearer tokens instead of Basic Auth.
- `FC-MUST-005`: registration does not include inline ID-image upload; it uses a forbidden separate upload endpoint.
- `FC-MUST-009`, `FC-MUST-010`, `FC-MUST-011`: seeding is hard-coded, manual, and destructive instead of startup JSON import.
- `FC-MUST-013` and `FC-MUST-014`: retention days are not persisted in the database and therefore cannot be admin-configured correctly.

## SHOULD Requirements

Priority `should` rows: `FC-SHOULD-001` through `FC-SHOULD-005`.

Key SHOULD gaps:

- Public slot discovery works, but the filter contract is not aligned cleanly with the documented `date` parameter.
- Staff visibility is branch-wide rather than clearly assignment/schedule-based.
- Reviewer-facing documentation is present but materially inaccurate for the challenge because it documents JWT and manual seed flow.

## BONUS Requirements

Priority `bonus` rows: `FC-BONUS-001`.

Current state:

- Queue endpoints exist only as `501 Not implemented` placeholders in `src/routes/queue.ts`.
- No bonus assets were found that should be considered part of the reviewer package yet.

## Hard Constraints

Literal hard constraints from the challenge, mapped to current repo status:

- `Basic Auth required (NOT JWT)` -> VIOLATION.
  Evidence: `src/middleware/auth.ts:22-43`, `src/routes/auth.ts:74-87`, `154-175`, `README.md:11`, `157-160`.
- `Startup seed import (not manual)` -> VIOLATION.
  Evidence: `src/index.ts:82-87` does not seed; `README.md:60` instructs manual `npm run db:seed`.
- `Seed import from provided JSON file` -> VIOLATION.
  Evidence: `prisma/seed.ts:6-220` hard-codes data in TypeScript; no JSON import exists.
- `Inline registration with ID image` -> VIOLATION.
  Evidence: `src/routes/auth.ts:10-88` is JSON-only; ID upload is separated into `src/routes/uploads.ts:202-321`.
- `DB-backed retention days` -> VIOLATION.
  Evidence: `src/routes/slots.ts:242-258` reads `req.query.days`; `prisma/schema.prisma:15-230` has no retention settings model/field.
- `Soft-delete slots` -> SATISFIED.
  Evidence: `prisma/schema.prisma:131-155`, `src/routes/slots.ts:710-799`.
- `Branch-scoped RBAC` -> PARTIAL.
  Evidence: `src/middleware/auth.ts:111-179` and branch-scoped route checks are present, but the overall auth layer is non-compliant because it depends on JWT.

## Gap Analysis Summary

### Totals By Status

- `satisfied`: 8
- `partial`: 9
- `missing`: 9
- Total traced rows: 26

### Critical Violations

- JWT bearer auth implemented where Basic Auth is explicitly required.
- Registration omits inline ID-image upload and substitutes a separate upload endpoint.
- Seed flow is manual, hard-coded, and destructive instead of startup JSON import.
- Retention days are passed by query string instead of being stored/configured in the database.

### Priority Fix Order

1. Replace JWT auth/login flow with the required Basic Auth contract across middleware, docs, and protected routes.
2. Rework customer registration into a single inline flow that stores the required ID image at registration time.
3. Implement startup seed import from the provided JSON file and make it convergent/idempotent instead of destructive.
4. Add DB-backed retention settings plus admin-only configuration endpoints and wire cleanup to stored retention days.
5. Finish the missing appointment contract pieces, especially true rescheduling and tighter staff-assigned schedule behavior.
6. Close audit coverage gaps for auth/bootstrap/configuration events.
7. Add migrations and correct README/examples so reviewer instructions match the actual compliant implementation.

## Assessment Notes

- This document intentionally treats the challenge prompt as the binding contract and the current repo only as evidence.
- Existing phase summaries in the repository overstate compliance in several places; the matrix above is based on implementation evidence, not progress docs.
