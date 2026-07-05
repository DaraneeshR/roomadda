-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "org_settings" (
    "id" UUID NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT 'RoomAdda',
    "displayName" TEXT NOT NULL DEFAULT 'RoomAdda',
    "gstin" TEXT,
    "pan" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "financialYear" INTEGER,
    "onlineBookingsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "walkInBookingsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("id")
);

