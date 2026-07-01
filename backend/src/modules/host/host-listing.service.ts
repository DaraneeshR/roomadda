import { Prisma, type ListingStatus } from "@prisma/client";
import type { UpdateHostListingInput, UpdateHostRoomInput } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { assertListingPublishable } from "../listing/listing.service.js";
import {
  classifyListingEdit,
  classifyRoomEdit,
  type EditClassification,
  type ListingEditable,
} from "./edit-classify.js";
import { hostListingInclude, type HostListingRow } from "./host-listing.serializer.js";

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
const roomNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "ROOM_NOT_FOUND", message: "Room not found" });

/** Map a loaded listing onto the keys an edit patch uses (for change detection). */
function editableSnapshot(l: HostListingRow): ListingEditable {
  return {
    alias: l.alias,
    actualName: l.actualName,
    areaLabel: l.areaLabel,
    city: l.city,
    pincode: l.pincode,
    fullAddress: l.fullAddress,
    latitude: l.latitude,
    longitude: l.longitude,
    gender: l.gender,
    amenities: l.amenities,
    houseRules: l.houseRules,
    mealsOffered: l.mealsOffered,
    mealChargesPaise: l.mealChargesPaise,
    tokenAmountPaise: l.tokenAmountPaise,
    instantBook: l.instantBook,
  };
}

export interface EditResult {
  listing: HostListingRow;
  classification: EditClassification;
}

export const hostListingService = {
  /** The host's own listings (ADMIN sees all), newest first, cursor-paginated. */
  async listForHost(actor: { id: string; role: string }, page: { cursor?: string; limit: number }): Promise<Page<HostListingRow>> {
    const where: Prisma.PgListingWhereInput = actor.role === "ADMIN" ? {} : { hostId: actor.id };
    const rows = await prisma.pgListing.findMany({
      where,
      include: hostListingInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, page.limit);
  },

  /** Load the full host view of a listing (ownership already enforced by the route). */
  async getRow(listingId: string): Promise<HostListingRow> {
    const row = await prisma.pgListing.findUnique({ where: { id: listingId }, include: hostListingInclude });
    if (!row) throw notFound();
    return row;
  },

  /**
   * Apply a host listing-field edit. Minor edits go live immediately; an address
   * change re-queues a PUBLISHED listing for approval (status -> PENDING_REVIEW).
   * Every edit appends to the edit-history log. A no-op patch (nothing actually
   * changed) is rejected so the history stays meaningful.
   */
  async updateListing(listingId: string, actorId: string, patch: UpdateHostListingInput): Promise<EditResult> {
    const before = await this.getRow(listingId);
    const classification = classifyListingEdit(editableSnapshot(before), patch);
    if (classification.changedFields.length === 0) {
      throw new AppError({ statusCode: 422, code: "NO_EFFECTIVE_CHANGE", message: "No fields were changed" });
    }
    // Re-queue only protects a LIVE listing; a DRAFT/PENDING listing just edits.
    const requeued = classification.requeue && before.status === "PUBLISHED";
    const nextStatus: ListingStatus | undefined = requeued ? "PENDING_REVIEW" : undefined;

    const listing = await prisma.$transaction(async (tx) => {
      const updated = await tx.pgListing.update({
        where: { id: listingId },
        data: { ...patch, ...(nextStatus ? { status: nextStatus } : {}) },
        include: hostListingInclude,
      });
      await tx.listingEditLog.create({
        data: { listingId, actorId, fields: classification.changedFields, requeued },
      });
      return updated;
    });
    await writeAudit({
      actorId,
      action: "host.listing.edited",
      targetId: listingId,
      metadata: { fields: classification.changedFields, requeued },
    });
    return { listing, classification: { ...classification, requeue: requeued } };
  },

  /**
   * Apply a host room edit. A monthly-rent change greater than 20% re-queues the
   * (PUBLISHED) parent listing for approval; other edits go live. Logged like a
   * listing edit.
   */
  async updateRoom(listingId: string, roomId: string, actorId: string, patch: UpdateHostRoomInput): Promise<EditResult> {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.listingId !== listingId) throw roomNotFound();
    const classification = classifyRoomEdit(
      {
        name: room.name,
        floor: room.floor,
        sharingType: room.sharingType,
        monthlyRentPaise: room.monthlyRentPaise,
        depositPaise: room.depositPaise,
      },
      patch,
    );
    if (classification.changedFields.length === 0) {
      throw new AppError({ statusCode: 422, code: "NO_EFFECTIVE_CHANGE", message: "No fields were changed" });
    }
    const parent = await prisma.pgListing.findUnique({ where: { id: listingId }, select: { status: true } });
    const requeued = classification.requeue && parent?.status === "PUBLISHED";

    const listing = await prisma.$transaction(async (tx) => {
      await tx.room.update({ where: { id: roomId }, data: patch });
      if (requeued) await tx.pgListing.update({ where: { id: listingId }, data: { status: "PENDING_REVIEW" } });
      await tx.listingEditLog.create({
        data: { listingId, actorId, fields: classification.changedFields.map((f) => `room.${f}`), requeued: requeued ?? false },
      });
      const fresh = await tx.pgListing.findUniqueOrThrow({ where: { id: listingId }, include: hostListingInclude });
      return fresh;
    });
    await writeAudit({
      actorId,
      action: "host.room.edited",
      targetId: roomId,
      metadata: { fields: classification.changedFields, requeued: requeued ?? false },
    });
    return { listing, classification: { ...classification, requeue: requeued ?? false } };
  },

  /**
   * A path to PUBLISHED: enforce the §9.2 go-live gate (>=5 photos, VERIFIED host
   * KYC, >=1 priced room) via the single shared guard, then publish. Reused on
   * EVERY publish path so the gate cannot be bypassed (/CLAUDE.md).
   */
  async publish(listingId: string, actorId: string): Promise<HostListingRow> {
    await assertListingPublishable(listingId); // throws 422 LISTING_NOT_PUBLISHABLE if unmet
    const listing = await prisma.pgListing.update({
      where: { id: listingId },
      data: { status: "PUBLISHED" },
      include: hostListingInclude,
    });
    await writeAudit({ actorId, action: "host.listing.published", targetId: listingId });
    return listing;
  },

  /** Pause/unpause: hide from tenant discovery without deleting (status untouched). */
  async setPaused(listingId: string, actorId: string, paused: boolean): Promise<HostListingRow> {
    const listing = await prisma.pgListing.update({
      where: { id: listingId },
      data: { paused },
      include: hostListingInclude,
    });
    await writeAudit({ actorId, action: paused ? "host.listing.paused" : "host.listing.unpaused", targetId: listingId });
    return listing;
  },

  /** Append-only edit history, newest first, cursor-paginated. */
  async editHistory(listingId: string, page: { cursor?: string; limit: number }) {
    const rows = await prisma.listingEditLog.findMany({
      where: { listingId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, page.limit);
  },

  /** Stamp a room as inventory-verified now (clears the "not verified in 3 days" flag). */
  async verifyInventory(listingId: string, roomId: string): Promise<HostListingRow> {
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { listingId: true } });
    if (!room || room.listingId !== listingId) throw roomNotFound();
    await prisma.room.update({ where: { id: roomId }, data: { inventoryVerifiedAt: new Date() } });
    return this.getRow(listingId);
  },

  /**
   * Manual walk-in inventory adjust. BLOCK marks `count` AVAILABLE beds as BLOCKED
   * (distinct from a platform BOOKED bed); UNBLOCK frees `count` BLOCKED beds. Beds
   * are row-locked (FOR UPDATE SKIP LOCKED) so a concurrent booking can't race it.
   * BOOKED/HELD beds are never touched here. Stamps the room as verified.
   */
  async adjustInventory(
    listingId: string,
    roomId: string,
    action: "BLOCK" | "UNBLOCK",
    count: number,
  ): Promise<HostListingRow> {
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { listingId: true } });
    if (!room || room.listingId !== listingId) throw roomNotFound();

    const fromStatus = action === "BLOCK" ? "AVAILABLE" : "BLOCKED";
    const toStatus = action === "BLOCK" ? "BLOCKED" : "AVAILABLE";

    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM beds
        WHERE "roomId" = ${roomId}::uuid AND status = ${fromStatus}::"BedStatus"
        ORDER BY label ASC
        LIMIT ${count}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length < count) {
        throw new AppError({
          statusCode: 409,
          code: "INSUFFICIENT_BEDS",
          message: `Only ${rows.length} ${fromStatus.toLowerCase()} bed(s) available to ${action.toLowerCase()}`,
        });
      }
      await tx.bed.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: toStatus } });
      await tx.room.update({ where: { id: roomId }, data: { inventoryVerifiedAt: new Date() } });
    });
    return this.getRow(listingId);
  },
};
