-- CreateEnum
CREATE TYPE "UserGender" AS ENUM ('MALE', 'FEMALE', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "OccupationType" AS ENUM ('STUDENT', 'WORKING_PROFESSIONAL');

-- AlterTable: optional self-managed profile fields (all nullable, non-breaking).
ALTER TABLE "users"
  ADD COLUMN "gender" "UserGender",
  ADD COLUMN "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN "occupationType" "OccupationType",
  ADD COLUMN "college" TEXT,
  ADD COLUMN "company" TEXT;

-- CreateTable
CREATE TABLE "wishlists" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wishlists_userId_idx" ON "wishlists"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wishlists_userId_listingId_key" ON "wishlists"("userId", "listingId");

-- AddForeignKey
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
