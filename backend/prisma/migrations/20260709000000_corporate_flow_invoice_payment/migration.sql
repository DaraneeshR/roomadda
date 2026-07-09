-- AlterTable
ALTER TABLE "corporate_invoices" ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT,
ADD COLUMN     "settledById" UUID,
ADD COLUMN     "settlementRef" TEXT,
ADD COLUMN     "webhookEventId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "corporate_invoices_razorpayOrderId_key" ON "corporate_invoices"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_invoices_razorpayPaymentId_key" ON "corporate_invoices"("razorpayPaymentId");

-- AddForeignKey
ALTER TABLE "corporate_invoices" ADD CONSTRAINT "corporate_invoices_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

