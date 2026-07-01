import type { ListingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import type { AuthUser } from "../../plugins/auth.js";

/**
 * Host-surface ownership gate. Every host route is default-deny (the route's
 * `requireRole("HOST","ADMIN")` preHandler) AND ownership-scoped here: a HOST may
 * only ever act on a listing they own; an ADMIN may act on any. A foreign or
 * absent listing is reported as 404 (never 403) so a host cannot probe another
 * host's inventory by id (see /CLAUDE.md domain rule #4 + privacy rules).
 */

export interface OwnedListing {
  id: string;
  hostId: string;
  status: ListingStatus;
  paused: boolean;
}

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });

/** Load a listing and assert the caller owns it (HOST) or is ADMIN; else 404. */
export async function requireOwnedListing(listingId: string, user: AuthUser): Promise<OwnedListing> {
  const listing = await prisma.pgListing.findUnique({
    where: { id: listingId },
    select: { id: true, hostId: true, status: true, paused: true },
  });
  if (!listing) throw notFound();
  const isOwnerHost = user.role === "HOST" && listing.hostId === user.id;
  if (user.role !== "ADMIN" && !isOwnerHost) throw notFound();
  return listing;
}

/**
 * Resolve the listing that owns a room and assert the caller owns it. Returns the
 * room (with its parent listing id) so callers don't re-query. 404 on any miss.
 */
export async function requireOwnedRoom(
  roomId: string,
  user: AuthUser,
): Promise<{ roomId: string; listing: OwnedListing }> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, listingId: true } });
  if (!room) throw notFound();
  const listing = await requireOwnedListing(room.listingId, user);
  return { roomId: room.id, listing };
}
