-- Rename the public-visible listing status ACTIVE -> PUBLISHED.
ALTER TYPE "ListingStatus" RENAME VALUE 'ACTIVE' TO 'PUBLISHED';

-- Public, filterable fields.
ALTER TABLE "pg_listings" ADD COLUMN "city" TEXT NOT NULL DEFAULT '';
ALTER TABLE "pg_listings" ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- Masked field (never returned publicly).
ALTER TABLE "pg_listings" ADD COLUMN "pincode" TEXT NOT NULL DEFAULT '';

-- city/pincode are required with no default in the schema; the empty-string
-- default above only backfills (there are no rows). Drop it to match schema.
ALTER TABLE "pg_listings" ALTER COLUMN "city" DROP DEFAULT;
ALTER TABLE "pg_listings" ALTER COLUMN "pincode" DROP DEFAULT;
