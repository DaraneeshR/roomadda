-- AlterTable: cached rating aggregate on the listing (maintained atomically on
-- every new review). Average is derived from these in the serializer — no float
-- is stored, and a zero-review listing stays at sum=0/count=0 → serializes null/0.
ALTER TABLE "pg_listings"
  ADD COLUMN "ratingSum" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: one review per booking (bookingId unique), by a tenant with an
-- eligible stay on the listing. rating is 1–5 (CHECK-guarded, defense in depth).
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "hostResponse" TEXT,
    "hostRespondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

-- One review per booking.
CREATE UNIQUE INDEX "reviews_bookingId_key" ON "reviews"("bookingId");

-- Serves the public "newest first" listing-reviews feed (keyset on createdAt,id).
CREATE INDEX "reviews_listingId_createdAt_idx" ON "reviews"("listingId", "createdAt");
CREATE INDEX "reviews_tenantId_idx" ON "reviews"("tenantId");

-- FKs. A review is cascade-deleted with its booking or listing; the tenant FK is
-- restrict (a reviewer's account is never hard-deleted out from under a review).
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
