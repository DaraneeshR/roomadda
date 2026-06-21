-- CreateEnum
CREATE TYPE "AdSlotType" AS ENUM ('DAY', 'WEEK');

-- AlterEnum
BEGIN;
CREATE TYPE "AdSlotStatus_new" AS ENUM ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');
ALTER TABLE "public"."ad_slots" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ad_slots" ALTER COLUMN "status" TYPE "AdSlotStatus_new" USING ("status"::text::"AdSlotStatus_new");
ALTER TYPE "AdSlotStatus" RENAME TO "AdSlotStatus_old";
ALTER TYPE "AdSlotStatus_new" RENAME TO "AdSlotStatus";
DROP TYPE "public"."AdSlotStatus_old";
ALTER TABLE "ad_slots" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';
COMMIT;

-- DropForeignKey
ALTER TABLE "ad_slots" DROP CONSTRAINT "ad_slots_pricingId_fkey";

-- DropIndex
DROP INDEX "ad_pricing_placement_durationDays_key";

-- DropIndex
DROP INDEX "ad_slots_placement_status_idx";

-- AlterTable
ALTER TABLE "ad_pricing" DROP COLUMN "durationDays",
DROP COLUMN "placement",
ADD COLUMN     "slotType" "AdSlotType" NOT NULL;

-- AlterTable
ALTER TABLE "ad_slots" DROP COLUMN "endsAt",
DROP COLUMN "placement",
DROP COLUMN "pricingId",
DROP COLUMN "startsAt",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "endDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "slotType" "AdSlotType" NOT NULL,
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- DropEnum
DROP TYPE "AdPlacement";

-- CreateIndex
CREATE UNIQUE INDEX "ad_pricing_slotType_key" ON "ad_pricing"("slotType");

-- CreateIndex
CREATE UNIQUE INDEX "ad_slots_razorpayOrderId_key" ON "ad_slots"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "ad_slots_status_startDate_endDate_idx" ON "ad_slots"("status", "startDate", "endDate");
