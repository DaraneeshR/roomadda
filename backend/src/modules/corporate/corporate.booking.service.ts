import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { assertPaise } from "../../lib/money.js";
import { nightsBetween, isExclusionViolation } from "../hotel/hotel.service.js";
import type { CorporateBooking as CorporateBookingDto } from "@roomadda/shared";
import type { AllocateEmployeeInput } from "./corporate.schema.js";
import { assertSameCompany, type CompanyContext } from "./corporate.access.js";
import { toBooking } from "./corporate.serializer.js";

/** Prisma include for a booking's drawn reservations + allocations. */
const bookingInclude = {
  reservations: { select: { id: true, checkIn: true, checkOut: true, status: true } },
  allocations: {
    include: {
      employee: { select: { fullName: true } },
      hotelReservation: { select: { checkIn: true, checkOut: true, status: true } },
    },
  },
} satisfies Prisma.CorporateBookingInclude;

const bookingNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "CORPORATE_BOOKING_NOT_FOUND", message: "Corporate booking not found" });
const noCorporateAvailability = (): AppError =>
  new AppError({ statusCode: 409, code: "NO_CORPORATE_AVAILABILITY", message: "Not enough corporate rooms for the requested dates" });

export const corporateBookingService = {
  /**
   * Convert an ACCEPTED quotation into a CorporateBooking, DRAWING the rooms from the
   * ring-fenced CORPORATE inventory (channel = CORPORATE units carved out by H0's
   * corporateReservedRooms). Each current-revision line item that names a hotel
   * category draws `quantity` rooms for the enquiry's date range, row-locked
   * (FOR UPDATE SKIP LOCKED) with the H0 GiST overbooking guard as the DB backstop —
   * an overlapping-date double-book is impossible. `totalPaise` snapshots the accepted
   * revision total (engine-sourced). Booking starts PENDING (confirmation is separate).
   */
  async convertQuotation(actorId: string, quotationId: string): Promise<CorporateBookingDto> {
    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        id: true,
        companyId: true,
        status: true,
        currentRevision: true,
        enquiryId: true,
        enquiry: { select: { checkIn: true, checkOut: true } },
        bookings: { select: { id: true } },
        revisions: { include: { lineItems: true } },
      },
    });
    if (!quotation) throw new AppError({ statusCode: 404, code: "QUOTATION_NOT_FOUND", message: "Quotation not found" });
    if (quotation.status !== "ACCEPTED") {
      throw new AppError({ statusCode: 409, code: "QUOTATION_NOT_ACCEPTED", message: "Only an accepted quotation can be booked" });
    }
    if (quotation.bookings.length > 0) {
      throw new AppError({ statusCode: 409, code: "ALREADY_BOOKED", message: "This quotation is already booked" });
    }
    if (!quotation.enquiry) {
      throw new AppError({ statusCode: 409, code: "ENQUIRY_REQUIRED", message: "A quotation needs an enquiry (for the stay dates) to book" });
    }
    const { checkIn, checkOut } = quotation.enquiry;
    const nights = nightsBetween(checkIn, checkOut);
    const revision = quotation.revisions.find((r) => r.revision === quotation.currentRevision);
    if (!revision) throw new AppError({ statusCode: 500, code: "REVISION_MISSING", message: "Quotation revision missing" });
    assertPaise(revision.totalPaise);

    // Only line items that name a hotel category draw rooms.
    const roomLines = revision.lineItems.filter((li) => li.categoryId !== null);
    if (roomLines.length === 0) {
      throw new AppError({ statusCode: 409, code: "NO_ROOM_LINES", message: "Quotation has no room line items to book" });
    }

    try {
      const booking = await prisma.$transaction(async (tx) => {
        const created = await tx.corporateBooking.create({
          data: {
            companyId: quotation.companyId,
            quotationId: quotation.id,
            createdById: actorId,
            status: "PENDING",
            totalPaise: revision.totalPaise,
          },
        });

        for (const line of roomLines) {
          const categoryId = line.categoryId!;
          for (let i = 0; i < line.quantity; i += 1) {
            // Allocate a free CORPORATE unit for the whole range, row-locked so a
            // concurrent draw can't take the same one (SKIP LOCKED picks another).
            const range = Prisma.sql`daterange(${checkIn}::date, ${checkOut}::date, '[)')`;
            const free = await tx.$queryRaw<{ id: string }[]>`
              SELECT hr.id
              FROM hotel_rooms hr
              WHERE hr."categoryId" = ${categoryId}::uuid
                AND hr.channel = 'CORPORATE'
                AND NOT EXISTS (
                  SELECT 1 FROM hotel_reservations r
                  WHERE r."hotelRoomId" = hr.id
                    AND r.status IN ('HELD', 'CONFIRMED')
                    AND daterange(r."checkIn", r."checkOut", '[)') && ${range}
                )
              ORDER BY hr.label ASC
              LIMIT 1
              FOR UPDATE OF hr SKIP LOCKED
            `;
            const unit = free[0];
            if (!unit) throw noCorporateAvailability();

            const roomTotalPaise = line.unitPricePaise * nights;
            assertPaise(roomTotalPaise);
            await tx.hotelReservation.create({
              data: {
                hotelRoomId: unit.id,
                categoryId,
                listingId: (await tx.hotelRoomCategory.findUniqueOrThrow({ where: { id: categoryId }, select: { listingId: true } })).listingId,
                corporateBookingId: created.id,
                channel: "CORPORATE",
                status: "HELD",
                checkIn,
                checkOut,
                perNightPaise: line.unitPricePaise,
                nights,
                roomTotalPaise,
                // Corporate money moves via the CorporateInvoice, not a per-reservation token.
                tokenAmountPaise: 0,
              },
            });
          }
        }

        await tx.corporateEnquiry.update({ where: { id: quotation.enquiryId! }, data: { status: "CONVERTED" } });
        return tx.corporateBooking.findUniqueOrThrow({ where: { id: created.id }, include: bookingInclude });
      });
      await writeAudit({ actorId, action: "corporate.booking.created", targetId: booking.id, metadata: { quotationId: quotation.id, rooms: roomLines.reduce((a, l) => a + l.quantity, 0) } });
      return toBooking(booking);
    } catch (err) {
      // The GiST overbooking guard (23P01) rejected an overlapping draw — treat as
      // "no corporate availability", never a 500.
      if (isExclusionViolation(err)) throw noCorporateAvailability();
      throw err;
    }
  },

  /**
   * ADMIN/CRM: manually confirm a corporate booking (the MVP confirmation path for
   * CREDIT stays — documented as acceptable). Flips the booking + its HELD
   * reservations to CONFIRMED and mints each reservation's check-in QR (what an
   * allocated employee sees). For PREPAY the webhook confirms instead (never here).
   */
  async confirmBooking(actorId: string, bookingId: string): Promise<CorporateBookingDto> {
    const booking = await prisma.corporateBooking.findUnique({ where: { id: bookingId }, select: { id: true, status: true } });
    if (!booking) throw bookingNotFound();
    if (booking.status === "CONFIRMED") return this.getById(bookingId);
    if (booking.status !== "PENDING") {
      throw new AppError({ statusCode: 409, code: "BOOKING_NOT_CONFIRMABLE", message: "Only a pending booking can be confirmed" });
    }
    const confirmed = await prisma.$transaction(async (tx) => {
      await confirmBookingReservations(tx, bookingId);
      return tx.corporateBooking.update({ where: { id: bookingId }, data: { status: "CONFIRMED", confirmedAt: new Date() }, include: bookingInclude });
    });
    await writeAudit({ actorId, action: "corporate.booking.confirmed", targetId: bookingId, metadata: { via: "admin_manual" } });
    return toBooking(confirmed);
  },

  /**
   * COMPANY(ADMIN): allocate one of the company's own employees to a corporate
   * reservation on one of its own bookings. Scoped both ways; a reservation can hold
   * at most one live allocation (unique index → 409).
   */
  async allocateEmployee(userId: string, ctx: CompanyContext, bookingId: string, input: AllocateEmployeeInput): Promise<CorporateBookingDto> {
    const booking = await prisma.corporateBooking.findUnique({ where: { id: bookingId }, select: { id: true, companyId: true } });
    if (!booking) throw bookingNotFound();
    assertSameCompany(booking.companyId, ctx);

    const [employee, reservation] = await Promise.all([
      prisma.employee.findUnique({ where: { id: input.employeeId }, select: { companyId: true } }),
      prisma.hotelReservation.findUnique({ where: { id: input.hotelReservationId }, select: { corporateBookingId: true } }),
    ]);
    if (!employee || employee.companyId !== ctx.companyId) throw new AppError({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND", message: "Employee not found" });
    if (!reservation || reservation.corporateBookingId !== bookingId) {
      throw new AppError({ statusCode: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found on this booking" });
    }

    try {
      await prisma.employeeAllocation.create({
        data: { corporateBookingId: bookingId, employeeId: input.employeeId, hotelReservationId: input.hotelReservationId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "RESERVATION_ALREADY_ALLOCATED", message: "This room is already allocated" });
      }
      throw err;
    }
    await writeAudit({ actorId: userId, action: "corporate.allocation.created", targetId: bookingId, metadata: { employeeId: input.employeeId, hotelReservationId: input.hotelReservationId } });
    return this.getById(bookingId, ctx);
  },

  async getById(id: string, ctx?: CompanyContext): Promise<CorporateBookingDto> {
    const booking = await prisma.corporateBooking.findUnique({ where: { id }, include: bookingInclude });
    if (!booking) throw bookingNotFound();
    if (ctx) assertSameCompany(booking.companyId, ctx);
    return toBooking(booking);
  },

  async listForCompany(ctx: CompanyContext, input: { cursor?: string; limit: number }): Promise<Page<CorporateBookingDto>> {
    return listBookings({ companyId: ctx.companyId, ...input });
  },

  /** ADMIN (CRM): corporate bookings across all companies (optional company filter). */
  async listAll(input: { companyId?: string; cursor?: string; limit: number }): Promise<Page<CorporateBookingDto>> {
    return listBookings(input);
  },
};

async function listBookings(input: { companyId?: string; cursor?: string; limit: number }): Promise<Page<CorporateBookingDto>> {
  const rows = await prisma.corporateBooking.findMany({
    where: input.companyId ? { companyId: input.companyId } : {},
    include: bookingInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const page = toPage(rows, input.limit);
  return { items: page.items.map(toBooking), nextCursor: page.nextCursor };
}

/**
 * Confirm every LIVE (HELD) reservation on a corporate booking, minting each one's
 * check-in QR. Shared by the admin manual-confirm path and the PREPAY webhook path so
 * a corporate reservation reaches CONFIRMED the same way regardless of trigger.
 */
export async function confirmBookingReservations(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const held = await tx.hotelReservation.findMany({
    where: { corporateBookingId: bookingId, status: "HELD" },
    select: { id: true },
  });
  for (const r of held) {
    await tx.hotelReservation.update({
      where: { id: r.id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), qrCodeToken: `cqr_${randomUUID().replace(/-/g, "")}` },
    });
  }
}
