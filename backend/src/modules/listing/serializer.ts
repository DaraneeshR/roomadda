import { Prisma, type ListingPhoto, type UserRole } from "@prisma/client";
import type { PrivateListing, PublicListing } from "@roomadda/shared";

/**
 * Listing masking (see /CLAUDE.md domain rule #4). The public shape NEVER
 * carries actualName, fullAddress, pincode, or exact latitude/longitude — only
 * alias, areaLabel, city, and a coarse approximate marker. Whether a caller may
 * see the private shape is decided by `canViewPrivateListing` and enforced in
 * the route.
 *
 * The `PublicListing` / `PrivateListing` DTO shapes are defined once in
 * `@roomadda/shared`; we re-export them here so callers keep importing from the
 * serializer while the contract stays single-sourced.
 */
export type { PrivateListing, PublicListing } from "@roomadda/shared";

/** Canonical relations loaded for every listing read, so types stay aligned. */
export const listingInclude = {
  photos: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
  rooms: {
    include: { beds: { select: { id: true, status: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.PgListingInclude;

export type ListingWithRelations = Prisma.PgListingGetPayload<{ include: typeof listingInclude }>;

interface PhotoView {
  id: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}

interface RoomView {
  id: string;
  name: string;
  floor: number | null;
  sharingType: number;
  monthlyRentPaise: number;
  depositPaise: number;
  totalBeds: number;
  availableBeds: number;
}

interface CommonListing {
  id: string;
  alias: string;
  areaLabel: string;
  city: string;
  gender: ListingWithRelations["gender"];
  status: ListingWithRelations["status"];
  amenities: string[];
  priceFromPaise: number | null;
  photos: PhotoView[];
  rooms: RoomView[];
  createdAt: string;
}

const toPhoto = (p: ListingPhoto): PhotoView => ({
  id: p.id,
  url: p.url,
  isPrimary: p.isPrimary,
  sortOrder: p.sortOrder,
});

const toRoom = (room: ListingWithRelations["rooms"][number]): RoomView => ({
  id: room.id,
  name: room.name,
  floor: room.floor,
  sharingType: room.sharingType,
  monthlyRentPaise: room.monthlyRentPaise,
  depositPaise: room.depositPaise,
  totalBeds: room.beds.length,
  availableBeds: room.beds.filter((b) => b.status === "AVAILABLE").length,
});

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Coarse, irreversible area marker (2 dp ≈ 1.1 km). Never the exact point. */
const approxLocation = (listing: ListingWithRelations): { lat: number; lng: number } => ({
  lat: roundTo(listing.latitude, 2),
  lng: roundTo(listing.longitude, 2),
});

function commonFields(listing: ListingWithRelations): CommonListing {
  const rents = listing.rooms.map((r) => r.monthlyRentPaise);
  return {
    id: listing.id,
    alias: listing.alias,
    areaLabel: listing.areaLabel,
    city: listing.city,
    gender: listing.gender,
    status: listing.status,
    amenities: listing.amenities,
    priceFromPaise: rents.length > 0 ? Math.min(...rents) : null,
    photos: listing.photos.map(toPhoto),
    rooms: listing.rooms.map(toRoom),
    createdAt: listing.createdAt.toISOString(),
  };
}

/** Masked view for the public / unauthorized callers. */
export function toPublicListing(listing: ListingWithRelations): PublicListing {
  return {
    ...commonFields(listing),
    masked: true,
    approxLocation: approxLocation(listing),
  };
}

/** Full view — ONLY for the owning host, ADMIN/AGENT, or a confirmed tenant. */
export function toPrivateListing(listing: ListingWithRelations): PrivateListing {
  return {
    ...commonFields(listing),
    masked: false,
    hostId: listing.hostId,
    actualName: listing.actualName,
    fullAddress: listing.fullAddress,
    pincode: listing.pincode,
    location: { lat: listing.latitude, lng: listing.longitude },
  };
}

export interface Viewer {
  id: string;
  role: UserRole;
}

/**
 * May this caller see the private (unmasked) listing? Pure decision so it is
 * unit-tested. `hasConfirmedBooking` is resolved by the caller (DB lookup).
 */
export function canViewPrivateListing(
  listing: { hostId: string },
  ctx: { user?: Viewer | null; hasConfirmedBooking: boolean },
): boolean {
  const user = ctx.user;
  if (!user) return false;
  if (user.role === "ADMIN" || user.role === "AGENT") return true;
  if (user.role === "HOST" && listing.hostId === user.id) return true;
  if (user.role === "TENANT" && ctx.hasConfirmedBooking) return true;
  return false;
}

/** May this caller create/modify this listing and its sub-resources? */
export function canManageListing(listing: { hostId: string }, user: Viewer): boolean {
  if (user.role === "ADMIN") return true;
  return user.role === "HOST" && listing.hostId === user.id;
}
