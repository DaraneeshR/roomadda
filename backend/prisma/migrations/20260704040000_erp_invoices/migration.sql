-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('CUSTOMER', 'COMMISSION');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "lineItems" JSONB NOT NULL DEFAULT '{}',
    "totalPaise" INTEGER NOT NULL,
    "paidPaise" INTEGER NOT NULL,
    "balancePaise" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_type_status_idx" ON "invoices"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_bookingId_type_key" ON "invoices"("bookingId", "type");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

