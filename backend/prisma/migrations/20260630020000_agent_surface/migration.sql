-- Agent surface: zone-scoping, GPS check-in, property inspections, and booking
-- attribution (assisted + walk-in). Closes the §9.1 agent zone-access invariant.

-- CreateEnum
CREATE TYPE "AgentBookingChannel" AS ENUM ('ASSISTED', 'WALK_IN');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InspectionRecommendation" AS ENUM ('APPROVE', 'APPROVE_WITH_CONDITIONS', 'REJECT');

-- AlterTable: agent zone (the §9.1 scope key; null for non-agents)
ALTER TABLE "users"
  ADD COLUMN "assignedCity" TEXT;

-- AlterTable: agent attribution on a booking (immutable once CONFIRMED)
ALTER TABLE "bookings"
  ADD COLUMN "bookedByAgentId" UUID,
  ADD COLUMN "agentChannel" "AgentBookingChannel";

-- AlterTable: GPS check-in on a visit
ALTER TABLE "agent_visits"
  ADD COLUMN "checkInLat" DOUBLE PRECISION,
  ADD COLUMN "checkInLng" DOUBLE PRECISION,
  ADD COLUMN "checkInAt" TIMESTAMP(3),
  ADD COLUMN "checkInDistanceM" DOUBLE PRECISION,
  ADD COLUMN "checkInValid" BOOLEAN;

-- CreateTable
CREATE TABLE "property_inspections" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "amenities" JSONB,
    "roomCountListed" INTEGER,
    "roomCountActual" INTEGER,
    "cleanliness" JSONB,
    "securityInfra" JSONB,
    "discrepancies" TEXT,
    "recommendation" "InspectionRecommendation",
    "notesForAdmin" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_photos" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_bookedByAgentId_status_idx" ON "bookings"("bookedByAgentId", "status");

-- CreateIndex
CREATE INDEX "agent_visits_agentId_scheduledAt_idx" ON "agent_visits"("agentId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "property_inspections_visitId_key" ON "property_inspections"("visitId");

-- CreateIndex
CREATE INDEX "property_inspections_status_submittedAt_idx" ON "property_inspections"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "property_inspections_listingId_idx" ON "property_inspections"("listingId");

-- CreateIndex
CREATE INDEX "inspection_photos_inspectionId_idx" ON "inspection_photos"("inspectionId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookedByAgentId_fkey" FOREIGN KEY ("bookedByAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "agent_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "property_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
