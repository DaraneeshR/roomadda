-- Reshape trust_tags into the AUTOMATED trust-badge model. The old TrustTagKind
-- set (VERIFIED_OWNER/…) was unused (no code, no data), so the table + enum are
-- dropped and recreated to the PRD badge set with earn/expiry/suspend tracking.

DROP TABLE "trust_tags";
DROP TYPE "TrustTagKind";

-- New enums
CREATE TYPE "TrustBadgeKind" AS ENUM (
  'RA_VERIFIED', 'RA_ASSURED', 'RA_CHOICE', 'LUXURY', 'WIZARD', 'TRENDING', 'INSTANT_BOOK', 'FEATURED'
);
CREATE TYPE "TrustBadgeSource" AS ENUM ('RULE', 'ADMIN');

-- Recreated table: one listing↔badge link with earn/expiry + admin-suspend audit.
CREATE TABLE "trust_tags" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "kind" "TrustBadgeKind" NOT NULL,
    "source" "TrustBadgeSource" NOT NULL DEFAULT 'RULE',
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspendedReason" TEXT,
    "suspendedById" UUID,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trust_tags_pkey" PRIMARY KEY ("id")
);

-- One link per (listing, badge kind).
CREATE UNIQUE INDEX "trust_tags_listingId_kind_key" ON "trust_tags"("listingId", "kind");
CREATE INDEX "trust_tags_kind_idx" ON "trust_tags"("kind");
-- Serves the expiry sweep (time-boxed badges past their window).
CREATE INDEX "trust_tags_expiresAt_idx" ON "trust_tags"("expiresAt");

ALTER TABLE "trust_tags"
  ADD CONSTRAINT "trust_tags_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_tags"
  ADD CONSTRAINT "trust_tags_suspendedById_fkey" FOREIGN KEY ("suspendedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
