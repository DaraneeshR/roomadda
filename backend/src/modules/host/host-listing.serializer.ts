import { Prisma } from "@prisma/client";
import type { HostListing, HostRoomInventory, ListingEditLogItem } from "@roomadda/shared";

/**
 * Host-listing serializer. The host sees the UNMASKED listing (they own it) plus
 * host-only fields (paused, houseRules, meals, token) and a per-room occupancy
 * rollup. Occupancy is split so walk-ins (BLOCKED, manual) are distinct from
 * platform bookings (BOOKED) — see the inventory spec.
 */

/** Beds unverified for longer than this window flag the room "not verified in 3 days". */
export const INVENTORY_VERIFY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export const hostListingInclude = {
  photos: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
  rooms: {
    include: { beds: { select: { status: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.PgListingInclude;

export type HostListingRow = Prisma.PgListingGetPayload<{ include: typeof hostListingInclude }>;
type HostRoomRow = HostListingRow["rooms"][number];

export function toHostRoomInventory(room: HostRoomRow, now: Date): HostRoomInventory {
  const counts = { BOOKED: 0, BLOCKED: 0, HELD: 0, AVAILABLE: 0 };
  for (const bed of room.beds) counts[bed.status] += 1;
  const verifiedAt = room.inventoryVerifiedAt;
  const needsVerification = !verifiedAt || now.getTime() - verifiedAt.getTime() > INVENTORY_VERIFY_WINDOW_MS;
  return {
    roomId: room.id,
    name: room.name,
    floor: room.floor,
    sharingType: room.sharingType,
    monthlyRentPaise: room.monthlyRentPaise,
    depositPaise: room.depositPaise,
    totalBeds: room.beds.length,
    bookedBeds: counts.BOOKED,
    walkInBeds: counts.BLOCKED,
    heldBeds: counts.HELD,
    availableBeds: counts.AVAILABLE,
    needsVerification,
    inventoryVerifiedAt: verifiedAt?.toISOString() ?? null,
  };
}

export function toHostListing(listing: HostListingRow, now: Date = new Date()): HostListing {
  const rents = listing.rooms.map((r) => r.monthlyRentPaise);
  return {
    id: listing.id,
    alias: listing.alias,
    actualName: listing.actualName,
    areaLabel: listing.areaLabel,
    city: listing.city,
    pincode: listing.pincode,
    fullAddress: listing.fullAddress,
    location: { lat: listing.latitude, lng: listing.longitude },
    gender: listing.gender,
    status: listing.status,
    paused: listing.paused,
    instantBook: listing.instantBook,
    amenities: listing.amenities,
    houseRules: listing.houseRules,
    mealsOffered: listing.mealsOffered,
    mealChargesPaise: listing.mealChargesPaise,
    tokenAmountPaise: listing.tokenAmountPaise,
    priceFromPaise: rents.length > 0 ? Math.min(...rents) : null,
    photos: listing.photos.map((p) => ({ id: p.id, url: p.url, isPrimary: p.isPrimary, sortOrder: p.sortOrder })),
    rooms: listing.rooms.map((r) => toHostRoomInventory(r, now)),
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

export function toEditLogItem(log: {
  id: string;
  fields: string[];
  requeued: boolean;
  createdAt: Date;
}): ListingEditLogItem {
  return { id: log.id, fields: log.fields, requeued: log.requeued, createdAt: log.createdAt.toISOString() };
}
