UPDATE "Customer"
SET
  "idNumber" = COALESCE(NULLIF("idNumber", ''), 'LEGACY-' || "id"),
  "dateOfBirth" = COALESCE("dateOfBirth", TIMESTAMP '1900-01-01 00:00:00'),
  "idImageUrl" = COALESCE(NULLIF("idImageUrl", ''), '/uploads/customer-ids/legacy-missing-image');

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "idNumber" SET NOT NULL,
ALTER COLUMN "dateOfBirth" SET NOT NULL,
ALTER COLUMN "idImageUrl" SET NOT NULL;
