-- CreateTable
CREATE TABLE "StaffServiceAssignment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffServiceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffServiceAssignment_staffId_idx" ON "StaffServiceAssignment"("staffId");

-- CreateIndex
CREATE INDEX "StaffServiceAssignment_serviceTypeId_idx" ON "StaffServiceAssignment"("serviceTypeId");

-- CreateIndex
CREATE INDEX "StaffServiceAssignment_branchId_idx" ON "StaffServiceAssignment"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffServiceAssignment_staffId_serviceTypeId_branchId_key" ON "StaffServiceAssignment"("staffId", "serviceTypeId", "branchId");

-- AddForeignKey
ALTER TABLE "StaffServiceAssignment" ADD CONSTRAINT "StaffServiceAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffServiceAssignment" ADD CONSTRAINT "StaffServiceAssignment_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffServiceAssignment" ADD CONSTRAINT "StaffServiceAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
