-- CreateEnum
CREATE TYPE "WalkInPaymentMode" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'OTHER');

-- AlterTable: listing create-step fields + host pause
ALTER TABLE "pg_listings"
  ADD COLUMN "mealsOffered" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mealChargesPaise" INTEGER,
  ADD COLUMN "houseRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "tokenAmountPaise" INTEGER,
  ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: per-room inventory verification stamp
ALTER TABLE "rooms"
  ADD COLUMN "inventoryVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "walk_in_tenants" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "bedId" UUID,
    "hostId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "aadhaarNumber" TEXT NOT NULL,
    "moveInDate" TIMESTAMP(3) NOT NULL,
    "monthlyRentPaise" INTEGER NOT NULL,
    "depositPaise" INTEGER NOT NULL DEFAULT 0,
    "paymentMode" "WalkInPaymentMode" NOT NULL DEFAULT 'CASH',
    "inviteTokenHash" TEXT,
    "invitedAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "walk_in_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_templates" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "days" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_edit_logs" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requeued" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_edit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "walk_in_tenants_inviteTokenHash_key" ON "walk_in_tenants"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "walk_in_tenants_listingId_checkedOutAt_idx" ON "walk_in_tenants"("listingId", "checkedOutAt");

-- CreateIndex
CREATE INDEX "walk_in_tenants_roomId_idx" ON "walk_in_tenants"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_templates_listingId_name_key" ON "meal_templates"("listingId", "name");

-- CreateIndex
CREATE INDEX "meal_templates_listingId_idx" ON "meal_templates"("listingId");

-- CreateIndex
CREATE INDEX "broadcasts_listingId_createdAt_idx" ON "broadcasts"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "listing_edit_logs_listingId_createdAt_idx" ON "listing_edit_logs"("listingId", "createdAt");

-- AddForeignKey
ALTER TABLE "walk_in_tenants" ADD CONSTRAINT "walk_in_tenants_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "walk_in_tenants" ADD CONSTRAINT "walk_in_tenants_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_templates" ADD CONSTRAINT "meal_templates_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_edit_logs" ADD CONSTRAINT "listing_edit_logs_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
