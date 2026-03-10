# FlowCare Minimal A+ Refactor Plan

Date: 2026-03-10
Inputs: `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/AUDIT.md`

This plan is ordered for execution, not aspiration. The first three items are the critical path and should be completed before any secondary fixes.

## Critical Priority

1. Replace JWT/Bearer auth with Basic Auth across the request contract
   - What to do: Remove token issuance and bearer-token verification. Authenticate every protected request from `Authorization: Basic <base64(email:password)>`, load the user from the database, verify the stored bcrypt hash, and attach a DB-backed `req.user` context that preserves role, customer, staff, and branch scope behavior.
   - Files: `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/utils/jwt.ts`, `src/types/index.ts`, `src/index.ts`, any route importing auth middleware.
   - Estimated effort: Large

2. Make startup seed compliant and idempotent
   - What to do: Replace the destructive manual seed flow with startup bootstrap logic that guarantees the default admin exists, imports seed data from the provided JSON source, and can be rerun safely without deleting live data.
   - Files: `prisma/seed.ts`, `src/index.ts`, `package.json`, seed JSON source once identified.
   - Estimated effort: Large

3. Rework registration into the required inline customer onboarding flow
   - What to do: Convert registration from JSON-only plus follow-up upload into a single registration flow that creates a customer account, stores required customer fields, and persists the ID image as part of registration. Registration must stop issuing JWTs.
   - Files: `src/routes/auth.ts`, `src/middleware/upload.ts`, `src/routes/uploads.ts`, `src/types/index.ts`, `src/utils/file-storage.ts`.
   - Estimated effort: Large

## High Priority

4. Remove JWT-specific code and docs drift
   - What to do: Delete or formally deprecate JWT helpers, remove `jsonwebtoken` usage, and update reviewer-facing docs/examples so they describe Basic Auth and the new auth contract only.
   - Files: `src/utils/jwt.ts`, `package.json`, `README.md`, any phase/status docs that claim JWT compliance.
   - Estimated effort: Small

5. Verify every protected route against the new authenticated user contract
   - What to do: Review all route handlers that read `req.user` so they rely on DB-enriched Basic Auth context rather than JWT claims. Keep admin, manager, staff, and customer access boundaries intact.
   - Files: `src/routes/appointments.ts`, `src/routes/audit.ts`, `src/routes/branches.ts`, `src/routes/customers.ts`, `src/routes/service-types.ts`, `src/routes/slots.ts`, `src/routes/staff.ts`, `src/routes/uploads.ts`.
   - Estimated effort: Medium

6. Persist and enforce retention settings from the database
   - What to do: Add a DB-backed retention-days setting, expose admin-only configuration, and make cleanup/preview use persisted configuration instead of request query parameters.
   - Files: `prisma/schema.prisma`, migration files, `src/routes/slots.ts`.
   - Estimated effort: Medium

7. Complete appointment contract gaps
   - What to do: Add true rescheduling, validate slot-to-branch consistency during booking, prevent invalid duplicate bookings, and replace hard delete behavior with status-preserving cancellation semantics where required.
   - Files: `src/routes/appointments.ts`, `src/types/index.ts`.
   - Estimated effort: Medium

## Medium Priority

8. Tighten customer data exposure and mutation rules
   - What to do: Remove sensitive ID fields from non-admin responses where they are overexposed, restrict who can update identity fields, and avoid duplicate customer-creation paths outside registration.
   - Files: `src/routes/customers.ts`, `src/routes/uploads.ts`, `src/routes/auth.ts`.
   - Estimated effort: Medium

9. Fill audit coverage gaps for sensitive actions
   - What to do: Ensure auth validation events, registration, seed/bootstrap actions, branch/service mutations, retention changes, and sensitive file access consistently write audit rows with branch context.
   - Files: `src/utils/audit-logger.ts`, `src/routes/auth.ts`, `src/routes/branches.ts`, `src/routes/service-types.ts`, `src/routes/slots.ts`, `src/index.ts`, `prisma/seed.ts`.
   - Estimated effort: Medium

10. Align upload/file handling with the final contract
   - What to do: Separate customer-ID image rules from appointment attachment rules, store usable metadata for secure retrieval, and keep authenticated file-serving behavior consistent.
   - Files: `src/middleware/upload.ts`, `src/utils/file-storage.ts`, `src/routes/uploads.ts`.
   - Estimated effort: Medium

## Low Priority

11. Clean up duplicate or misleading route surface
   - What to do: Remove duplicate upload route mounting if it is not part of the intended API contract, and simplify public-vs-authenticated branch/service discovery behavior.
   - Files: `src/index.ts`, `src/routes/branches.ts`, `src/routes/uploads.ts`.
   - Estimated effort: Small

12. Refresh reviewer package accuracy
   - What to do: Update README, examples, and operational notes so setup, auth usage, public endpoints, and seeding instructions match the actual compliant implementation.
   - Files: `README.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/AUDIT.md`, summary/status docs as needed.
   - Estimated effort: Small

## Dependencies

- Item 1 blocks item 5 because route access checks depend on the new authenticated user shape.
- Item 1 blocks item 4 because JWT cleanup should happen after the Basic Auth replacement is in place.
- Item 2 should land before any reviewer-facing documentation updates in item 12 so startup instructions reflect the final seed behavior.
- Item 3 depends partly on item 10 because registration needs the correct upload/storage contract.
- Item 6 is independent of the auth swap, but should wait until the critical path is stable so schema and route changes do not overlap unnecessarily.
- Item 7 depends on item 1 because appointment ownership and branch checks use authenticated user context.
- Item 8 depends on item 3 for the final source of truth on customer creation and ID storage.
- Item 9 should follow items 1 through 3 so audit coverage is attached to the final auth, seed, and registration flows rather than interim behavior.

## Recommended Execution Order

1. Item 1: Basic Auth replacement
2. Item 2: Startup seed/default admin compliance
3. Item 3: Inline registration with ID image
4. Item 5: Route-by-route auth contract verification
5. Item 4: JWT cleanup/docs drift removal
6. Item 6: DB-backed retention settings
7. Item 7: Appointment contract fixes
8. Items 8 to 12: data exposure, audit coverage, upload alignment, route cleanup, documentation accuracy
