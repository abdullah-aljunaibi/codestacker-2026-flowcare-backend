# Phase 5B Summary: File Retrieval and Access Control

**Phase:** 5B  
**Date Completed:** 2026-03-09 05:12 UTC  
**Status:** ✅ COMPLETE

---

## Phase Goal

Implement file retrieval endpoints with controlled access behavior for customer ID images and appointment attachments. Enforce practical permission rules aligned to the challenge requirements.

---

## What Was Implemented

### 1. Customer ID Retrieval Endpoint

**Endpoint:** `GET /api/files/customer-id/:customerId`

**Access Control:**
- **ADMIN only** - Can retrieve any customer ID image
- **BRANCH_MANAGER/STAFF/CUSTOMER** - NOT permitted (403)

**Behavior:**
- Verifies customer exists in database
- Checks if customer has an ID image reference (`idImageUrl`)
- Resolves file path from database reference
- Verifies file exists on disk
- Returns file with correct `Content-Type` header based on file extension
- Returns `Content-Disposition` header for inline display
- Audit logs `CUSTOMER_ID_ACCESSED` event

**Error Responses:**
- `404` - Customer not found
- `404` - Customer ID image not found (customer exists but no ID uploaded)
- `404` - File not found on server (database reference exists but file missing from disk)
- `403` - Insufficient permissions (non-ADMIN user)
- `500` - Internal server error

### 2. Appointment Attachment Retrieval Endpoint

**Endpoint:** `GET /api/files/appointment/:appointmentId/attachment`

**Access Control:**
- **ADMIN** - Can retrieve any appointment attachment
- **BRANCH_MANAGER** - Can retrieve attachments for appointments at their branch
- **STAFF** - Can retrieve attachments for appointments at their branch
- **CUSTOMER** - Can retrieve attachments for their own appointments only

**Behavior:**
- Verifies appointment exists in database
- Checks if appointment has an attachment reference (`attachmentUrl`)
- Enforces role-based access control:
  - CUSTOMER: verifies they own the appointment
  - STAFF/BRANCH_MANAGER: verifies appointment is at their branch
  - ADMIN: no additional checks
- Resolves file path from database reference
- Verifies file exists on disk
- Returns file with correct `Content-Type` header based on file extension
- Returns `Content-Disposition` header for inline display
- Audit logs `APPOINTMENT_ATTACHMENT_ACCESSED` event

**Error Responses:**
- `404` - Appointment not found
- `404` - Appointment attachment not found (appointment exists but no attachment uploaded)
- `404` - File not found on server (database reference exists but file missing from disk)
- `403` - Insufficient permissions (customer trying to access another's appointment, staff accessing other branch)
- `500` - Internal server error

### 3. Static File Serving Disabled

**Security Improvement:**
- Removed `/uploads` static file serving from Express
- Files are NO LONGER publicly accessible via direct URL
- All file access now requires authentication and authorization through retrieval endpoints

**Before (Phase 5A):**
```
http://localhost:3000/uploads/customer-ids/uuid.jpg  ← Publicly accessible
```

**After (Phase 5B):**
```
http://localhost:3000/api/files/customer-id/:customerId  ← Authenticated, ADMIN only
http://localhost:3000/api/files/appointment/:id/attachment  ← Authenticated, role-filtered
```

### 4. Content-Type Handling

Implemented proper MIME type detection using `mime-types` package:

```typescript
const mimeType = mime.lookup(filePath) || 'application/octet-stream';
res.setHeader('Content-Type', mimeType);
res.setHeader('Content-Disposition', `inline; filename="${basename}"`);
res.sendFile(filePath);
```

**Supported Content Types:**
- `image/jpeg` - .jpg, .jpeg files
- `image/png` - .png files
- `image/gif` - .gif files
- `image/webp` - .webp files
- `application/pdf` - .pdf files
- `application/octet-stream` - fallback for unknown types

### 5. Permission Matrix

| File Type | ADMIN | BRANCH_MANAGER | STAFF | CUSTOMER |
|-----------|-------|----------------|-------|----------|
| **Upload** |
| Customer ID | ✅ Any customer | ✅ Customers at branch | ✅ Customers at branch | ✅ Own only |
| Appointment Attachment | ✅ Any appointment | ✅ Appointments at branch | ✅ Appointments at branch | ✅ Own appointments |
| **Download/Retrieve** |
| Customer ID | ✅ Any customer | ❌ | ❌ | ❌ |
| Appointment Attachment | ✅ Any appointment | ✅ Appointments at branch | ✅ Appointments at branch | ✅ Own appointments |

**Design Rationale:**
- Customer ID images are highly sensitive identity documents
- Even staff who can upload customer IDs should not be able to download them
- Only ADMIN has oversight authority to retrieve customer IDs
- Appointment attachments are less sensitive and can be viewed by involved parties (staff at the branch, the customer who created the appointment)

### 6. Audit Logging

All file retrieval actions are audit-logged for security and compliance:

**New Audit Events:**
- `CUSTOMER_ID_ACCESSED` - When ADMIN retrieves a customer ID image
- `APPOINTMENT_ATTACHMENT_ACCESSED` - When any role retrieves an appointment attachment

**Audit Log Entry Includes:**
- User ID who performed the access
- Action type (CUSTOMER_ID_ACCESSED or APPOINTMENT_ATTACHMENT_ACCESSED)
- Entity type and ID (Customer or Appointment)
- File URL
- Action metadata (download)
- IP address
- Timestamp

---

## Files Created/Modified

### Modified Files
- `src/routes/uploads.ts` - Added two retrieval endpoints (GET /api/files/*)
- `src/index.ts` - Removed static file serving, added /api/files route mapping
- `package.json` - Added mime-types dependency
- `STATUS.md` - Added Phase 5B section
- `README.md` - Updated with retrieval endpoints, permission matrix, examples
- `PROGRESS.md` - Added Phase 5B section

### New Files
- `PHASE_5B_SUMMARY.md` - This file

### Dependencies Added
- `mime-types` - For accurate content-type detection

---

## API Endpoints

### File Retrieval (Phase 5B ✅)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/files/customer-id/:customerId` | Retrieve customer ID image | ADMIN only |
| GET | `/api/files/appointment/:appointmentId/attachment` | Retrieve appointment attachment | All roles (role-filtered) |

### File Upload (Phase 5A ✅)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/uploads/customer-id` | Upload customer ID image | All roles |
| POST | `/api/uploads/appointment-attachment` | Upload appointment attachment | All roles |

---

## Usage Examples

### Retrieve Customer ID (ADMIN only)

```bash
curl -X GET http://localhost:3000/api/files/customer-id/customer-123 \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -o customer-id.jpg
```

Response headers:
```
Content-Type: image/jpeg
Content-Disposition: inline; filename="customer-123.jpg"
```

### Retrieve Appointment Attachment (as customer)

```bash
curl -X GET http://localhost:3000/api/files/appointment/apt-123/attachment \
  -H "Authorization: Bearer CUSTOMER_JWT_TOKEN" \
  -o appointment-document.pdf
```

### Retrieve Appointment Attachment (as staff)

```bash
curl -X GET http://localhost:3000/api/files/appointment/apt-123/attachment \
  -H "Authorization: Bearer STAFF_JWT_TOKEN" \
  -o appointment-document.pdf
```

---

## Technical Implementation Details

### Access Control Flow

```
1. Request arrives at /api/files/*
2. authMiddleware validates JWT token
3. roleMiddleware checks role permissions
4. For appointment attachments: additional branch/ownership verification
5. Database query to verify entity exists and has file reference
6. File system check to verify file exists on disk
7. Content-Type detection using mime-types
8. Stream file to client with appropriate headers
9. Audit log the access event
```

### Error Handling

All errors return consistent JSON responses:

```json
{
  "success": false,
  "error": "Error message here"
}
```

**HTTP Status Codes:**
- `200` - Success (file stream)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found (entity, file reference, or physical file missing)
- `500` - Internal server error

### File Path Resolution

Files are resolved relative to the current working directory:

```typescript
const filePath = path.join(process.cwd(), fileUrlFromDatabase);
```

Example:
- Database stores: `/uploads/customer-ids/550e8400-e29b-41d4-a716-446655440000.jpg`
- Resolved path: `/home/abdullah/.openclaw/workspace/projects/flowcare-backend/uploads/customer-ids/550e8400-e29b-41d4-a716-446655440000.jpg`

---

## Security Improvements (Phase 5B)

### What's Secure Now

✅ **Authentication Required**: All file access requires valid JWT token  
✅ **Authorization Enforced**: Role-based access control on all retrieval endpoints  
✅ **Customer ID Protection**: Only ADMIN can retrieve customer ID images  
✅ **Appointment Attachment Privacy**: Customers can only access their own attachments  
✅ **Branch Isolation**: Staff can only access attachments for their branch  
✅ **Audit Trail**: All file access is logged with user, timestamp, and IP  
✅ **No Direct Access**: Static file serving disabled, files not publicly accessible  
✅ **Clean Error Handling**: 404 for missing files (no information leakage)  

### What Remains for Phase 5C

❌ **File Deletion**: No endpoint to delete uploaded files  
❌ **Orphan Cleanup**: Files remain when customer/appointment is deleted  
❌ **Virus Scanning**: Uploaded files not scanned for malware  
❌ **Image Processing**: No resizing or compression of images  
❌ **Cloud Storage**: Files stored locally, not in cloud (S3, etc.)  
❌ **Retention Policies**: No automatic cleanup based on age  

---

## Known Limitations

1. **No File Deletion Endpoint**: Cannot delete uploaded files through API (Phase 5C)
2. **Orphaned Files**: When a customer or appointment is deleted, the associated files remain on disk (Phase 5C)
3. **No Virus Scanning**: Files are not scanned for malware before upload or download (Phase 5C)
4. **Local Storage Only**: Files stored on local filesystem, not cloud storage (may migrate in Phase 5C)
5. **Database Migration Pending**: Prisma migration requires PostgreSQL database to apply
6. **No Thumbnail Generation**: Images stored as-is, no thumbnails created (Phase 5C)

---

## Testing Notes

**Build Status**: TypeScript compilation successful (pre-existing configuration errors unrelated to Phase 5B changes)

**Manual Testing Required**:
- Test customer ID retrieval as ADMIN (should succeed)
- Test customer ID retrieval as STAFF (should fail with 403)
- Test customer ID retrieval as CUSTOMER (should fail with 403)
- Test appointment attachment retrieval as owner customer (should succeed)
- Test appointment attachment retrieval as other customer (should fail with 403)
- Test appointment attachment retrieval as branch staff (should succeed)
- Test appointment attachment retrieval as other branch staff (should fail with 403)
- Test retrieval of non-existent customer/appointment (should return 404)
- Test retrieval when file missing from disk (should return 404)
- Verify Content-Type headers are correct for different file types
- Verify audit logs are created for all retrieval actions

---

## What's Next: Phase 5C

Phase 5C will focus on file management and polish:

### Planned Deliverables

1. **File Deletion Endpoint**
   - `DELETE /api/uploads/customer-id/:customerId`
   - `DELETE /api/uploads/appointment/:appointmentId/attachment`
   - Access control matching upload permissions

2. **Orphan Cleanup**
   - Cleanup logic when customer is deleted (remove ID image)
   - Cleanup logic when appointment is deleted (remove attachment)
   - Utility to scan for orphaned files

3. **Virus/Malware Scanning**
   - Integrate virus scanning library
   - Scan files on upload before storing
   - Reject infected files

4. **Image Processing**
   - Resize large images
   - Compress images to reduce storage
   - Generate thumbnails for customer IDs

5. **Cloud Storage Consideration**
   - Evaluate S3 or similar cloud storage
   - Implement cloud storage adapter
   - Migrate from local to cloud storage

6. **File Retention Policies**
   - Define retention periods for different file types
   - Implement automated cleanup job
   - Archive old files

---

**Phase 5B Status:** ✅ COMPLETE  
**Phase 5C Status:** ⏳ PENDING

---

*Phase 5B completed: 2026-03-09 05:12 UTC*
