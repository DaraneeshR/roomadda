import { Prisma, type Booking } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { bookingDetailInclude, type BookingWithRelations } from "./booking.serializer.js";

const HOLD_TTL_MS = 15 * 60 * 1000; // 15-minute hold
const LIVE_STATUSES: Prisma.BookingWhereInput["status"] = {
  in: ["INITIATED", "TOKEN_PENDING", "CONFIRMED"],
};

interface LockedBedRow {
  id: string;
  status: string;
  roomId: string;
  monthlyRentPaise: number | null;
}

export const bookingService = {
  /**
   * Place a hold on a bed. Inside one transaction we row-lock the bed
   * (SELECT ... FOR UPDATE) so concurrent attempts serialize; the partial
   * unique index uniq_live_booking_per_bed is the backstop if anything slips
   * through. Money is snapshotted at hold time.
   */
  async createBookingHold(
    tenantId: string,
    input: { bedId: string; moveInDate?: Date },
  ): Promise<Booking> {
    try {
      return await prisma.$transaction(async (tx) => {
        // Row-lock the bed (parameterized raw — /CLAUDE.md).
        const bedRows = await tx.$queryRaw<LockedBedRow[]>`
          SELECT id, status::text AS status, "roomId", "monthlyRentPaise"
          FROM beds
          WHERE id = ${input.bedId}::uuid
          FOR UPDATE
        `;
        const bed = bedRows[0];
        if (!bed) {
          throw new AppError({ statusCode: 404, code: "BED_NOT_FOUND", message: "Bed not found" });
        }
        if (bed.status !== "AVAILABLE") {
          throw new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed is not available" });
        }

        // Defence in depth (the unique index is the true guarantee).
        const live = await tx.booking.findFirst({
          where: { bedId: input.bedId, status: LIVE_STATUSES },
          select: { id: true },
        });
        if (live) {
          throw new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed already has a live booking" });
        }

        const room = await tx.room.findUnique({
          where: { id: bed.roomId },
          select: { listingId: true, monthlyRentPaise: true, depositPaise: true },
        });
        if (!room) {
          throw new AppError({ statusCode: 404, code: "ROOM_NOT_FOUND", message: "Room not found" });
        }

        const monthlyRentPaise = bed.monthlyRentPaise ?? room.monthlyRentPaise;
        const depositPaise = room.depositPaise;
        // Token to secure the bed: the deposit if set, else one month's rent.
        const tokenAmountPaise = depositPaise > 0 ? depositPaise : monthlyRentPaise;
        if (tokenAmountPaise <= 0) {
          throw new AppError({ statusCode: 400, code: "BED_NOT_BOOKABLE", message: "This bed has no token price configured" });
        }
        assertPaise(tokenAmountPaise);
        assertPaise(monthlyRentPaise);
        assertPaise(depositPaise);

        const booking = await tx.booking.create({
          data: {
            bedId: input.bedId,
            tenantId,
            listingId: room.listingId,
            status: "TOKEN_PENDING",
            tokenAmountPaise,
            monthlyRentPaise,
            depositPaise,
            moveInDate: input.moveInDate ?? null,
            holdExpiresAt: new Date(Date.now() + HOLD_TTL_MS),
          },
        });
        await tx.bed.update({ where: { id: input.bedId }, data: { status: "HELD" } });
        return booking;
      });
    } catch (err) {
      // The partial unique index rejected a concurrent double-hold.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed already has a live booking" });
      }
      throw err;
    }
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
    if (!booking || booking.tenantId !== tenantId) {
      throw new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
    }
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
   * Sweep expired holds: INITIATED/TOKEN_PENDING past holdExpiresAt -> EXPIRED,
   * and free their still-HELD beds. One atomic CTE statement. Run by the BullMQ
   * job. Returns the number of beds freed.
   */
  async expireStaleHolds(): Promise<number> {
    return prisma.$executeRaw`
      WITH expired AS (
        UPDATE bookings
        SET status = 'EXPIRED', "updatedAt" = now()
        WHERE status IN ('INITIATED', 'TOKEN_PENDING')
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
