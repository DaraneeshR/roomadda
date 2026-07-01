-- CreateEnum
CREATE TYPE "ServiceRequestCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'CLEANING', 'APPLIANCE', 'WIFI', 'FURNITURE', 'PEST_CONTROL', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceRequestPriority" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "bookingId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "category" "ServiceRequestCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "ServiceRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "photoRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request_comments" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorRole" "UserRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_ticketNumber_key" ON "service_requests"("ticketNumber");

-- CreateIndex
CREATE INDEX "service_requests_tenantId_createdAt_idx" ON "service_requests"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "service_requests_listingId_status_idx" ON "service_requests"("listingId", "status");

-- CreateIndex
CREATE INDEX "service_requests_priority_status_escalated_idx" ON "service_requests"("priority", "status", "escalated");

-- CreateIndex
CREATE INDEX "service_request_comments_requestId_createdAt_idx" ON "service_request_comments"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_comments" ADD CONSTRAINT "service_request_comments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_comments" ADD CONSTRAINT "service_request_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
