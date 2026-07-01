-- CreateEnum
CREATE TYPE "RentInvoiceStatus" AS ENUM ('DUE', 'PAID', 'OVERDUE');

-- CreateTable
CREATE TABLE "rent_invoices" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "periodMonth" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "RentInvoiceStatus" NOT NULL DEFAULT 'DUE',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "webhookEventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rent_invoices_razorpayOrderId_key" ON "rent_invoices"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "rent_invoices_razorpayPaymentId_key" ON "rent_invoices"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "rent_invoices_bookingId_idx" ON "rent_invoices"("bookingId");

-- CreateIndex
CREATE INDEX "rent_invoices_status_dueDate_idx" ON "rent_invoices"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "rent_invoices_bookingId_periodMonth_key" ON "rent_invoices"("bookingId", "periodMonth");

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
