import { Prisma, type AgentBookingChannel, type Booking, type UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertPaise, effectiveTokenPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { bookingDetailInclude, type BookingWithRelations } from "./booking.serializer.js";
import type { CreateBookingInput } from "./booking.schema.js";

const HOLD_TTL_MS = 15 * 60 * 1000; // instant-book payment window once payable
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // host-accept window for Request-to-Book
// Once a host ACCEPTS a Request-to-Book, the bed is locked for the tenant to pay
// the token (PRD: a 4h payment window — longer than the instant-book window
// because the tenant is reacting to the accept rather than paying inline).
const ACCEPT_HOLD_TTL_MS = 4 * 60 * 60 * 1000;

/** Statuses that hold a bed (cannot be double-booked). Includes the awaiting-host state. */
const LIVE_STATUSES: Prisma.BookingWhereInput["status"] = {
  in: ["INITIATED", "PENDING_APPROVAL", "TOKEN_PENDING", "CONFIRMED"],
};

interface LockedBedRow {
  id: string;
  status: string;
  roomId: string;
  monthlyRentPaise: number | null;
}

const bedNotAvailable = () =>
  new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed is not available" });
const bookingNotFound = () =>
  new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });

/** Row-lock a specific bed. */
async function lockBedById(tx: Prisma.TransactionClient, bedId: string): Promise<LockedBedRow> {
  const rows = await tx.$queryRaw<LockedBedRow[]>`
    SELECT id, status::text AS status, "roomId", "monthlyRentPaise"
    FROM beds WHERE id = ${bedId}::uuid FOR UPDATE
  `;
  const bed = rows[0];
  if (!bed) throw new AppError({ statusCode: 404, code: "BED_NOT_FOUND", message: "Bed not found" });
  if (bed.status !== "AVAILABLE") throw bedNotAvailable();
  return bed;
}

/** Pick + row-lock any AVAILABLE bed in a room (discovery is masked — no bed ids). */
async function lockAvailableBedInRoom(tx: Prisma.TransactionClient, roomId: string): Promise<LockedBedRow> {
  const rows = await tx.$queryRaw<LockedBedRow[]>`
    SELECT id, status::text AS status, "roomId", "monthlyRentPaise"
    FROM beds
    WHERE "roomId" = ${roomId}::uuid AND status = 'AVAILABLE'
    ORDER BY label ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;
  const bed = rows[0];
  if (!bed) throw new AppError({ statusCode: 409, code: "ROOM_FULL", message: "No beds available in this room" });
  return bed;
}

export const bookingService = {
  /**
   * Place a hold. Accepts either a specific `bedId` or a `roomId` (the server
   * picks an AVAILABLE bed — discovery never exposes bed ids). The bed is
   * row-locked (FOR UPDATE) and the partial unique index is the backstop.
   *
   * Instant Book → TOKEN_PENDING (payable now). Request-to-Book →
   * PENDING_APPROVAL (payment blocked until the host accepts). Money is
   * snapshotted at hold time.
   *
   * `attribution` records an AGENT-initiated booking (assisted / walk-in): the
   * agent who created it, the channel, and an overridden hold TTL (e.g. the 2h
   * assisted-pay window). Attribution is written here at hold time and is never
   * altered afterwards — it is IMMUTABLE once the booking confirms (§9.1).
   */
  async createBookingHold(
    tenantId: string,
    input: CreateBookingInput,
    attribution?: { agentId: string; channel: AgentBookingChannel; holdTtlMs?: number },
  ): Promise<Booking> {
    try {
      return await prisma.$transaction(async (tx) => {
        const bed = input.bedId
          ? await lockBedById(tx, input.bedId)
          : await lockAvailableBedInRoom(tx, input.roomId!);

        // Defence in depth (the unique index is the true guarantee).
        const live = await tx.booking.findFirst({
          where: { bedId: bed.id, status: LIVE_STATUSES },
          select: { id: true },
        });
        if (live) throw bedNotAvailable();

        const room = await tx.room.findUnique({
          where: { id: bed.roomId },
          select: {
            listingId: true,
            monthlyRentPaise: true,
            depositPaise: true,
            listing: { select: { instantBook: true, tokenAmountPaise: true } },
          },
        });
        if (!room) throw new AppError({ statusCode: 404, code: "ROOM_NOT_FOUND", message: "Room not found" });

        const monthlyRentPaise = bed.monthlyRentPaise ?? room.monthlyRentPaise;
        const depositPaise = room.depositPaise;
        // Token to secure the bed: the host-configured token if set, else the
        // deposit, else one month's rent. Same policy the listing serializer
        // shows the tenant pre-booking, so the charge can never surprise them.
        const tokenAmountPaise = effectiveTokenPaise(room.listing.tokenAmountPaise, { depositPaise, monthlyRentPaise });
        if (tokenAmountPaise <= 0) {
          throw new AppError({ statusCode: 400, code: "BED_NOT_BOOKABLE", message: "This bed has no token price configured" });
        }
        assertPaise(tokenAmountPaise);
        assertPaise(monthlyRentPaise);
        assertPaise(depositPaise);

        const instant = room.listing.instantBook;
        const status = instant ? "TOKEN_PENDING" : "PENDING_APPROVAL";
        // Agent holds may override the instant-book TTL (the 2h assisted window).
        const ttlMs = instant ? attribution?.holdTtlMs ?? HOLD_TTL_MS : REQUEST_TTL_MS;

        const booking = await tx.booking.create({
          data: {
            bedId: bed.id,
            tenantId,
            listingId: room.listingId,
            status,
            tokenAmountPaise,
            monthlyRentPaise,
            depositPaise,
            moveInDate: input.moveInDate ?? null,
            mealPlan: input.mealPlan ?? null,
            bookedByAgentId: attribution?.agentId ?? null,
            agentChannel: attribution?.channel ?? null,
            holdExpiresAt: new Date(Date.now() + ttlMs),
          },
        });
        await tx.bed.update({ where: { id: bed.id }, data: { status: "HELD" } });
        return booking;
      });
    } catch (err) {
      // The partial unique index rejected a concurrent double-hold.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw bedNotAvailable();
      }
      throw err;
    }
  },

  /**
   * Host (or admin) accepts a Request-to-Book hold, unlocking payment. Ownership
   * is enforced; a non-owner sees 404 (existence never leaked). NEVER confirms —
   * confirmation still comes only from the verified webhook (see /CLAUDE.md).
   */
  async acceptBooking(actor: { id: string; role: UserRole }, bookingId: string): Promise<Booking> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: { select: { hostId: true } } },
    });
    const isOwnerHost = actor.role === "HOST" && booking?.listing.hostId === actor.id;
    if (!booking || (actor.role !== "ADMIN" && !isOwnerHost)) throw bookingNotFound();
    if (booking.status !== "PENDING_APPROVAL") {
      throw new AppError({ statusCode: 409, code: "BOOKING_NOT_PENDING_APPROVAL", message: "Booking is not awaiting approval" });
    }
    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "TOKEN_PENDING", holdExpiresAt: new Date(Date.now() + ACCEPT_HOLD_TTL_MS) },
    });
    await writeAudit({
      actorId: actor.id,
      action: "booking.accepted",
      targetId: bookingId,
      metadata: { before: "PENDING_APPROVAL", after: "TOKEN_PENDING" },
    });
    return updated;
  },

  // Cancellation + refunds live in the refund module (refundService) so the
  // policy and the "refund truth = webhook" rule are enforced in exactly one
  // place. The cancel/decline routes call refundService directly.

  /** Data for the confirmed-booking PDF receipt (tenant-owned, CONFIRMED only). */
  async getReceiptData(bookingId: string, tenantId: string) {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        tenant: { select: { fullName: true } },
        listing: { select: { actualName: true, areaLabel: true, city: true } },
        payment: { include: { transactions: true } },
      },
    });
    if (!b || b.tenantId !== tenantId) throw bookingNotFound();
    if (b.status !== "CONFIRMED") {
      throw new AppError({ statusCode: 409, code: "RECEIPT_NOT_READY", message: "Receipt is available once the booking is confirmed" });
    }
    const txn = b.payment?.transactions.find((t) => t.method === "RAZORPAY" && t.status === "CAPTURED");
    return {
      bookingId: b.id,
      tenantName: b.tenant.fullName,
      listingName: b.listing.actualName,
      area: `${b.listing.areaLabel}, ${b.listing.city}`,
      moveInDate: b.moveInDate,
      tokenAmountPaise: b.tokenAmountPaise,
      monthlyRentPaise: b.monthlyRentPaise,
      paymentId: txn?.razorpayPaymentId ?? null,
      confirmedAt: b.confirmedAt,
    };
  },

  /**
   * Load one booking for its tenant, with everything the payment screen polls.
   * Ownership is enforced here: a booking owned by someone else is reported as
   * 404 (NOT 403) so the existence of the id is never leaked.
   */
  async getDetailForTenant(bookingId: string, tenantId: string): Promise<BookingWithRelations> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingDetailInclude,
    });
    if (!booking || booking.tenantId !== tenantId) throw bookingNotFound();
    return booking;
  },

  /** The caller's own bookings, newest first, cursor-paginated (max 50). */
  async listForTenant(
    tenantId: string,
    input: { cursor?: string; limit: number },
  ): Promise<Page<BookingWithRelations>> {
    const rows = await prisma.booking.findMany({
      where: { tenantId },
      include: bookingDetailInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, input.limit);
  },

  /**
   * Sweep expired holds: INITIATED/PENDING_APPROVAL/TOKEN_PENDING past
   * holdExpiresAt -> EXPIRED, and free their still-HELD beds. One atomic CTE.
   * Returns the number of beds freed.
   */
  async expireStaleHolds(): Promise<number> {
    return prisma.$executeRaw`
      WITH expired AS (
        UPDATE bookings
        SET status = 'EXPIRED', "updatedAt" = now()
        WHERE status IN ('INITIATED', 'PENDING_APPROVAL', 'TOKEN_PENDING')
          AND "holdExpiresAt" IS NOT NULL
          AND "holdExpiresAt" < now()
        RETURNING "bedId"
      )
      UPDATE beds
      SET status = 'AVAILABLE', "updatedAt" = now()
      WHERE id IN (SELECT "bedId" FROM expired) AND status = 'HELD'
    `;
  },
};
