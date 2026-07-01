import { Prisma, type WalkInTenant } from "@prisma/client";
import type { CreateWalkInInput, WalkInTenant as WalkInDTO } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { assertPaise } from "../../lib/money.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { smsSender } from "../../lib/sms.js";
import { generateRefreshToken, hashRefreshToken } from "../../lib/tokens.js";

/**
 * Walk-in entry. A host records an off-platform occupant (typing the tenant's
 * details, including the Aadhaar NUMBER — never an uploaded doc). Creating a
 * walk-in BLOCKS a bed (reduces availability, flagged distinctly from a platform
 * booking) and fires an app-invite SMS with a single-use pre-registration token
 * (raw token in the SMS only; only its hash is stored). Aadhaar is never logged
 * and never returned in full (serializer exposes only the last 4 digits).
 */

const roomInclude = { room: { select: { name: true } } } satisfies Prisma.WalkInTenantInclude;
export type WalkInRow = Prisma.WalkInTenantGetPayload<{ include: typeof roomInclude }>;

export function toWalkIn(w: WalkInRow): WalkInDTO {
  return {
    id: w.id,
    name: w.name,
    phone: w.phone,
    // NEVER the full Aadhaar number — only the last 4 digits.
    aadhaarLast4: w.aadhaarNumber.slice(-4),
    roomId: w.roomId,
    roomName: w.room.name,
    moveInDate: w.moveInDate.toISOString(),
    monthlyRentPaise: w.monthlyRentPaise,
    depositPaise: w.depositPaise,
    paymentMode: w.paymentMode,
    invited: w.invitedAt !== null,
    invitedAt: w.invitedAt?.toISOString() ?? null,
    checkedOutAt: w.checkedOutAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
  };
}

const reload = (id: string): Promise<WalkInRow> =>
  prisma.walkInTenant.findUniqueOrThrow({ where: { id }, include: roomInclude });

export const walkInService = {
  /**
   * Record a walk-in tenant on `listingId` (ownership already enforced by the
   * route). Row-locks and BLOCKS an AVAILABLE bed in the chosen room (so two
   * concurrent walk-ins can't take the same bed), then best-effort SMSes the
   * app-invite. The walk-in stands even if the SMS fails (invitedAt left null so
   * the host can resend).
   */
  async create(listingId: string, hostId: string, input: CreateWalkInInput): Promise<WalkInRow> {
    assertPaise(input.monthlyRentPaise);
    assertPaise(input.depositPaise);

    const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { listingId: true } });
    if (!room || room.listingId !== listingId) {
      throw new AppError({ statusCode: 404, code: "ROOM_NOT_FOUND", message: "Room not found" });
    }

    const registrationToken = generateRefreshToken();
    const inviteTokenHash = hashRefreshToken(registrationToken);

    const created = await prisma.$transaction(async (tx) => {
      const beds = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM beds
        WHERE "roomId" = ${input.roomId}::uuid AND status = 'AVAILABLE'
        ORDER BY label ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const bed = beds[0];
      if (!bed) throw new AppError({ statusCode: 409, code: "ROOM_FULL", message: "No beds available in this room" });
      await tx.bed.update({ where: { id: bed.id }, data: { status: "BLOCKED" } });
      return tx.walkInTenant.create({
        data: {
          listingId,
          roomId: input.roomId,
          bedId: bed.id,
          hostId,
          name: input.name,
          phone: input.phone,
          aadhaarNumber: input.aadhaarNumber,
          moveInDate: input.moveInDate,
          monthlyRentPaise: input.monthlyRentPaise,
          depositPaise: input.depositPaise,
          paymentMode: input.paymentMode,
          inviteTokenHash,
        },
        include: roomInclude,
      });
    });

    // Best-effort app-invite (post-commit). The raw token leaves the server ONLY
    // here; on success we stamp invitedAt. Never log the token / Aadhaar.
    try {
      await smsSender.sendWalkInInvite({
        toPhone: input.phone,
        tenantName: input.name,
        listingAlias: await listingAlias(listingId),
        registrationToken,
      });
      await prisma.walkInTenant.update({ where: { id: created.id }, data: { invitedAt: new Date() } });
    } catch (err) {
      logger.error({ err, walkInId: created.id }, "walk-in app-invite SMS failed; left un-invited for resend");
    }

    await writeAudit({ actorId: hostId, action: "host.walkin.recorded", targetId: created.id, metadata: { listingId } });
    return reload(created.id);
  },

  /** Walk-ins for a listing (current by default; includeCheckedOut adds past). */
  async listForListing(
    listingId: string,
    query: { includeCheckedOut?: boolean; cursor?: string; limit: number },
  ): Promise<Page<WalkInRow>> {
    const rows = await prisma.walkInTenant.findMany({
      where: { listingId, ...(query.includeCheckedOut ? {} : { checkedOutAt: null }) },
      include: roomInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, query.limit);
  },

  /**
   * Mark a walk-in checked out: stamp checkedOutAt and free its bed back to
   * AVAILABLE. Ownership is enforced here — a walk-in on a listing the caller
   * doesn't own is reported as 404.
   */
  async checkout(walkInId: string, actor: { id: string; role: string }): Promise<WalkInRow> {
    const walkIn = await prisma.walkInTenant.findUnique({
      where: { id: walkInId },
      include: { listing: { select: { hostId: true } } },
    });
    const isOwnerHost = actor.role === "HOST" && walkIn?.listing.hostId === actor.id;
    if (!walkIn || (actor.role !== "ADMIN" && !isOwnerHost)) {
      throw new AppError({ statusCode: 404, code: "WALKIN_NOT_FOUND", message: "Walk-in not found" });
    }
    if (walkIn.checkedOutAt) {
      throw new AppError({ statusCode: 409, code: "ALREADY_CHECKED_OUT", message: "Walk-in is already checked out" });
    }
    await prisma.$transaction(async (tx) => {
      await tx.walkInTenant.update({ where: { id: walkInId }, data: { checkedOutAt: new Date() } });
      if (walkIn.bedId) {
        // Only free a bed we still hold (BLOCKED) — never stomp a live booking.
        await tx.bed.updateMany({ where: { id: walkIn.bedId, status: "BLOCKED" }, data: { status: "AVAILABLE" } });
      }
    });
    await writeAudit({ actorId: actor.id, action: "host.walkin.checkedOut", targetId: walkInId });
    return reload(walkInId);
  },
};

/** Masked alias for the invite SMS (never the actualName — /CLAUDE.md). */
async function listingAlias(listingId: string): Promise<string> {
  const l = await prisma.pgListing.findUnique({ where: { id: listingId }, select: { alias: true } });
  return l?.alias ?? "your PG";
}

export type { WalkInTenant };
