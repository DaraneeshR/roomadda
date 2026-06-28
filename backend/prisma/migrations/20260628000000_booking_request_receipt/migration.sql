-- AlterEnum: Request-to-Book holds wait here until the host accepts.
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterTable: Instant Book vs Request-to-Book per listing.
ALTER TABLE "pg_listings" ADD COLUMN "instantBook" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: tenant's chosen meal plan (free text; meals module is post-MVP).
ALTER TABLE "bookings" ADD COLUMN "mealPlan" TEXT;
