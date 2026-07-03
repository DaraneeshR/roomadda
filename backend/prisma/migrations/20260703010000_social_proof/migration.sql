-- AlterTable: cached "booked N times recently" social-proof count on the listing.
-- REAL confirmed-paid bookings + host walk-ins within `recentBookingWindowDays`,
-- as of `recentBookingCountAt`. Recomputed by the social-booked cron, never on
-- the read path. A null window means "never swept yet" → the widget is omitted.
ALTER TABLE "pg_listings"
  ADD COLUMN "recentBookingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recentBookingWindowDays" INTEGER,
  ADD COLUMN "recentBookingCountAt" TIMESTAMP(3);
