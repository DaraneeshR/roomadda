-- CreateEnum
CREATE TYPE "LeaveNoticeStatus" AS ENUM ('ACTIVE', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "beds" ADD COLUMN     "vacatingFrom" TIMESTAMP(3),
ADD COLUMN     "vacatingSoon" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "leave_notices" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "bedId" UUID NOT NULL,
    "moveOutDate" TIMESTAMP(3) NOT NULL,
    "status" "LeaveNoticeStatus" NOT NULL DEFAULT 'ACTIVE',
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_contacts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trusted_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_notices_bookingId_idx" ON "leave_notices"("bookingId");

-- CreateIndex
CREATE INDEX "leave_notices_tenantId_createdAt_idx" ON "leave_notices"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "trusted_contacts_userId_idx" ON "trusted_contacts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_contacts_userId_phone_key" ON "trusted_contacts"("userId", "phone");

-- AddForeignKey
ALTER TABLE "leave_notices" ADD CONSTRAINT "leave_notices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_notices" ADD CONSTRAINT "leave_notices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
