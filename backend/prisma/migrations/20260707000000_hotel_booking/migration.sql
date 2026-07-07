-- AlterTable
ALTER TABLE "hotel_reservations" ADD COLUMN     "qrCodeToken" TEXT,
ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT,
ADD COLUMN     "tokenAmountPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "webhookEventId" UUID;

-- AlterTable
ALTER TABLE "refund_transactions" ADD COLUMN     "hotelReservationId" UUID,
ALTER COLUMN "paymentId" DROP NOT NULL,
ALTER COLUMN "bookingId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "hotel_reservations_razorpayOrderId_key" ON "hotel_reservations"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_reservations_razorpayPaymentId_key" ON "hotel_reservations"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_reservations_qrCodeToken_key" ON "hotel_reservations"("qrCodeToken");

-- CreateIndex
CREATE INDEX "hotel_reservations_guestId_idx" ON "hotel_reservations"("guestId");

-- CreateIndex
CREATE INDEX "refund_transactions_hotelReservationId_idx" ON "refund_transactions"("hotelReservationId");

-- AddForeignKey
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_hotelReservationId_fkey" FOREIGN KEY ("hotelReservationId") REFERENCES "hotel_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

