import { Prisma, type Bed, type KycStatus, type ListingPhoto, type Room } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { listingInclude, type ListingWithRelations } from "./serializer.js";
import type {
  CreateBedInput,
  CreateListingInput,
  CreatePhotoInput,
  CreateRoomInput,
  ListFilters,
  NearbyQuery,
  UpdateListingInput,
} from "./listing.schema.js";

export interface ListingOwnership {
  id: string;
  hostId: string;
  status: ListingWithRelations["status"];
}

export interface NearbyItem {
  listing: ListingWithRelations;
  distanceM: number;
}

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });

/** Minimum photos a listing needs before it can go live (PRD §9.2). */
export const MIN_PUBLISH_PHOTOS = 5;

/** Which §9.2 go-live conditions failed; machine-readable for the client. */
export type PublishGateFailure = "photos" | "kyc" | "rooms";

/** Snapshot of a passing gate evaluation, recorded in the publish audit entry. */
export interface PublishGateSnapshot {
  status: ListingWithRelations["status"];
  photoCount: number;
  /** Always VERIFIED on a passing gate (the gate throws otherwise). */
  kycStatus: KycStatus;
  hasPricedRoom: boolean;
}

/**
 * Enforce the PRD §9.2 go-live gate: a listing may transition to PUBLISHED ONLY
 * if it has at least {@link MIN_PUBLISH_PHOTOS} photos, the host's KYC is
 * VERIFIED, and at least one room has a rent > 0 paise. All three are evaluated
 * in ONE query set; on failure it throws a typed 422 carrying
 * `{ failed: [...] }` so the caller knows exactly which conditions to fix.
 * Returns the passing snapshot (for the audit trail) when the listing is
 * eligible. This is the single guard every publish path MUST call.
 */
export async function assertListingPublishable(listingId: string): Promise<PublishGateSnapshot> {
  const listing = await prisma.pgListing.findUnique({
    where: { id: listingId },
    select: {
      status: true,
      host: { select: { kyc: { select: { status: true } } } },
      _count: { select: { photos: true } },
      // One priced room is enough to satisfy the condition — take(1) keeps it cheap.
      rooms: { where: { monthlyRentPaise: { gt: 0 } }, select: { id: true }, take: 1 },
    },
  });
  if (!listing) throw notFound();

  const photoCount = listing._count.photos;
  const kycStatus = listing.host.kyc?.status ?? null;
  const hasPricedRoom = listing.rooms.length > 0;

  const failed: PublishGateFailure[] = [];
  if (photoCount < MIN_PUBLISH_PHOTOS) failed.push("photos");
  if (kycStatus !== "VERIFIED") failed.push("kyc");
  if (!hasPricedRoom) failed.push("rooms");

  if (failed.length > 0) {
    throw new AppError({
      statusCode: 422,
      code: "LISTING_NOT_PUBLISHABLE",
      message: "Listing does not meet the go-live requirements",
      details: { failed },
    });
  }

  // failed is empty, so kycStatus is necessarily VERIFIED here.
  return { status: listing.status, photoCount, kycStatus: "VERIFIED", hasPricedRoom };
}

// --- nearby cursor (keyset on distance,id) ---------------------------------
function encodeNearbyCursor(distanceM: number, id: string): string {
  return Buffer.from(`${distanceM}:${id}`).toString("base64url");
}
function decodeNearbyCursor(cursor: string): { distanceM: number; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const idx = decoded.indexOf(":");
  const distanceM = idx >= 0 ? Number(decoded.slice(0, idx)) : NaN;
  const id = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (!Number.isFinite(distanceM) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new AppError({ statusCode: 400, code: "INVALID_CURSOR", message: "Invalid cursor" });
  }
  return { distanceM, id };
}

export const listingService = {
  /** Minimal fetch for ownership/visibility checks. */
  async getOwnership(id: string): Promise<ListingOwnership | null> {
    return prisma.pgListing.findUnique({
      where: { id },
      select: { id: true, hostId: true, status: true },
    });
  },

  async getById(id: string): Promise<ListingWithRelations | null> {
    return prisma.pgListing.findUnique({ where: { id }, include: listingInclude });
  },

  /** Does this tenant hold a CONFIRMED booking on this listing? */
  async hasConfirmedBooking(listingId: string, tenantId: string): Promise<boolean> {
    const booking = await prisma.booking.findFirst({
      where: { listingId, tenantId, status: "CONFIRMED" },
      select: { id: true },
    });
    return booking !== null;
  },

  async createListing(hostId: string, input: CreateListingInput): Promise<ListingWithRelations> {
    return prisma.pgListing.create({
      data: { ...input, hostId },
      include: listingInclude,
    });
  },

  async updateListing(id: string, input: UpdateListingInput): Promise<ListingWithRelations> {
    // The §9.2 go-live gate applies to EVERY path that can publish a listing —
    // a status edit to PUBLISHED here is gated exactly like admin publish.
    if (input.status === "PUBLISHED") {
      await assertListingPublishable(id);
    }
    return prisma.pgListing.update({ where: { id }, data: input, include: listingInclude });
  },

  async addRoom(listingId: string, input: CreateRoomInput): Promise<Room> {
    assertPaise(input.monthlyRentPaise);
    assertPaise(input.depositPaise);
    return prisma.room.create({ data: { ...input, listingId } });
  },

  async addBed(listingId: string, roomId: string, input: CreateBedInput): Promise<Bed> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, listingId: true },
    });
    if (!room || room.listingId !== listingId) {
      throw new AppError({ statusCode: 404, code: "ROOM_NOT_FOUND", message: "Room not found" });
    }
    if (input.monthlyRentPaise !== undefined) assertPaise(input.monthlyRentPaise);
    try {
      return await prisma.bed.create({ data: { roomId, ...input } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({
          statusCode: 409,
          code: "BED_LABEL_TAKEN",
          message: "A bed with this label already exists in the room",
        });
      }
      throw err;
    }
  },

  async addPhoto(listingId: string, input: CreatePhotoInput): Promise<ListingPhoto> {
    // If this photo is primary, demote any existing primary — two writes, so a
    // transaction (see /CLAUDE.md).
    if (input.isPrimary) {
      const [, photo] = await prisma.$transaction([
        prisma.listingPhoto.updateMany({
          where: { listingId, isPrimary: true },
          data: { isPrimary: false },
        }),
        prisma.listingPhoto.create({ data: { ...input, listingId } }),
      ]);
      return photo;
    }
    return prisma.listingPhoto.create({ data: { ...input, listingId } });
  },

  /** Public, PUBLISHED-only, filtered + cursor-paginated listing browse. */
  async listPublished(filters: ListFilters): Promise<Page<ListingWithRelations>> {
    const where: Prisma.PgListingWhereInput = { status: "PUBLISHED" };
    if (filters.city) where.city = { equals: filters.city, mode: "insensitive" };
    if (filters.area) where.areaLabel = { contains: filters.area, mode: "insensitive" };
    if (filters.gender) where.gender = filters.gender;
    if (filters.amenities && filters.amenities.length > 0) {
      where.amenities = { hasEvery: filters.amenities };
    }

    if (filters.minRentPaise !== undefined) assertPaise(filters.minRentPaise);
    if (filters.maxRentPaise !== undefined) assertPaise(filters.maxRentPaise);

    const roomFilter: Prisma.RoomWhereInput = {};
    if (filters.sharingType !== undefined) roomFilter.sharingType = filters.sharingType;
    if (filters.minRentPaise !== undefined || filters.maxRentPaise !== undefined) {
      roomFilter.monthlyRentPaise = {
        ...(filters.minRentPaise !== undefined ? { gte: filters.minRentPaise } : {}),
        ...(filters.maxRentPaise !== undefined ? { lte: filters.maxRentPaise } : {}),
      };
    }
    if (Object.keys(roomFilter).length > 0) where.rooms = { some: roomFilter };

    const rows = await prisma.pgListing.findMany({
      where,
      include: listingInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, filters.limit);
  },

  /**
   * Nearest PUBLISHED listings within radiusM. Uses ST_DWithin on the geography
   * column (served by idx_pg_listings_location) and orders by ST_Distance. All
   * inputs are bound parameters (no string concatenation — /CLAUDE.md).
   */
  async nearby(query: NearbyQuery): Promise<{ items: NearbyItem[]; nextCursor: string | null }> {
    const { lat, lng, radiusM, limit } = query;
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
    const cursor = query.cursor ? decodeNearbyCursor(query.cursor) : null;
    const keyset = cursor
      ? Prisma.sql`AND (
          ST_Distance(location, ${point}) > ${cursor.distanceM}
          OR (ST_Distance(location, ${point}) = ${cursor.distanceM} AND id > ${cursor.id}::uuid)
        )`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<Array<{ id: string; distance_m: number }>>`
      SELECT id, ST_Distance(location, ${point}) AS distance_m
      FROM pg_listings
      WHERE status = 'PUBLISHED'
        AND location IS NOT NULL
        AND ST_DWithin(location, ${point}, ${radiusM})
        ${keyset}
      ORDER BY distance_m ASC, id ASC
      LIMIT ${limit + 1}
    `;

    let pageRows = rows;
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      if (last) nextCursor = encodeNearbyCursor(last.distance_m, last.id);
    }

    if (pageRows.length === 0) return { items: [], nextCursor: null };

    const ids = pageRows.map((r) => r.id);
    const distanceById = new Map(pageRows.map((r) => [r.id, r.distance_m]));
    const listings = await prisma.pgListing.findMany({
      where: { id: { in: ids } },
      include: listingInclude,
    });
    const byId = new Map(listings.map((l) => [l.id, l]));

    const items: NearbyItem[] = [];
    for (const id of ids) {
      const listing = byId.get(id);
      const distanceM = distanceById.get(id);
      if (listing && distanceM !== undefined) items.push({ listing, distanceM });
    }
    return { items, nextCursor };
  },
};

export { notFound as listingNotFound };
