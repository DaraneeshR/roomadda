-- CreateEnum
CREATE TYPE "CommissionSettlementStatus" AS ENUM ('PENDING', 'RECEIVED');

-- CreateTable
CREATE TABLE "commission_ledger" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "paidToPgPaise" INTEGER NOT NULL DEFAULT 0,
    "status" "CommissionSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3),
    "receivedById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_ledger_bookingId_key" ON "commission_ledger"("bookingId");

-- CreateIndex
CREATE INDEX "commission_ledger_status_idx" ON "commission_ledger"("status");

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

