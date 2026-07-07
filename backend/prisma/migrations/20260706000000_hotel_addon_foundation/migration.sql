-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('PG', 'HOTEL', 'FLAT');

-- CreateEnum
CREATE TYPE "ListingVisibility" AS ENUM ('USER_ONLY', 'CORPORATE_ONLY', 'BOTH');

-- CreateEnum
CREATE TYPE "HotelBookingChannel" AS ENUM ('B2C', 'CORPORATE');

-- CreateEnum
CREATE TYPE "HotelReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "pg_listings" ADD COLUMN     "propertyType" "PropertyType" NOT NULL DEFAULT 'PG',
ADD COLUMN     "visibility" "ListingVisibility" NOT NULL DEFAULT 'USER_ONLY';

-- CreateTable
CREATE TABLE "hotel_room_categories" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "perNightPaise" INTEGER NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalRooms" INTEGER NOT NULL,
    "corporateReservedRooms" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_room_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_rooms" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "channel" "HotelBookingChannel" NOT NULL DEFAULT 'B2C',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_reservations" (
    "id" UUID NOT NULL,
    "hotelRoomId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "guestId" UUID,
    "channel" "HotelBookingChannel" NOT NULL DEFAULT 'B2C',
    "status" "HotelReservationStatus" NOT NULL DEFAULT 'HELD',
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "perNightPaise" INTEGER NOT NULL,
    "nights" INTEGER NOT NULL,
    "roomTotalPaise" INTEGER NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_room_categories_listingId_idx" ON "hotel_room_categories"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_categories_listingId_tier_key" ON "hotel_room_categories"("listingId", "tier");

-- CreateIndex
CREATE INDEX "hotel_rooms_categoryId_channel_idx" ON "hotel_rooms"("categoryId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_rooms_categoryId_label_key" ON "hotel_rooms"("categoryId", "label");

-- CreateIndex
CREATE INDEX "hotel_reservations_hotelRoomId_idx" ON "hotel_reservations"("hotelRoomId");

-- CreateIndex
CREATE INDEX "hotel_reservations_categoryId_status_idx" ON "hotel_reservations"("categoryId", "status");

-- CreateIndex
CREATE INDEX "hotel_reservations_listingId_status_idx" ON "hotel_reservations"("listingId", "status");

-- AddForeignKey
ALTER TABLE "hotel_room_categories" ADD CONSTRAINT "hotel_room_categories_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "hotel_room_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_hotelRoomId_fkey" FOREIGN KEY ("hotelRoomId") REFERENCES "hotel_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "hotel_room_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

