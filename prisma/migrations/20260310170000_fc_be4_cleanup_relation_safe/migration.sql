-- AlterTable
ALTER TABLE "Appointment"
ALTER COLUMN "slotId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_slotId_fkey";

-- AddForeignKey
ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_slotId_fkey"
FOREIGN KEY ("slotId") REFERENCES "Slot"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
