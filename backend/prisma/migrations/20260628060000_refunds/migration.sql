-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('TENANT', 'HOST', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('INITIATED', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cancelledBy" "CancelledBy",
ADD COLUMN     "refundPaise" INTEGER,
ADD COLUMN     "refundReason" TEXT;

-- CreateTable
CREATE TABLE "refund_transactions" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'INITIATED',
    "razorpayRefundId" TEXT,
    "webhookEventId" UUID,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_transactions_razorpayRefundId_key" ON "refund_transactions"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "refund_transactions_paymentId_idx" ON "refund_transactions"("paymentId");

-- CreateIndex
CREATE INDEX "refund_transactions_bookingId_idx" ON "refund_transactions"("bookingId");

-- CreateIndex
CREATE INDEX "refund_transactions_status_idx" ON "refund_transactions"("status");

-- AddForeignKey
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
