# FlowCare Documentation Stabilization Plan

Date: 2026-03-10

This repository snapshot already uses Basic Authentication. The remaining reviewer-facing work is documentation discipline:

1. Keep only mounted endpoints in reviewer-facing API docs.
2. Keep every authentication reference phrased as HTTP Basic Authentication.
3. Keep curl examples aligned with the current request shapes:
   - `POST /api/auth/register` uses multipart form data with `idImage`
   - `POST /api/auth/login` uses the `Authorization: Basic ...` header or curl `-u`
   - `POST /api/appointments` uses multipart form data with optional `attachment`
   - `POST /api/uploads/appointment-attachment` uses multipart form data with `appointmentId` and `appointmentAttachment`
4. Keep status and audit notes focused on the current mounted API surface, not superseded implementation history.
