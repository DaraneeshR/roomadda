/**
 * ERP-2 bookings ledger + booking/KYC detail (§15.3). The ledger is the single
 * searchable/sortable table of what's been booked; the detail is one screen with
 * the customer, the full invoice breakdown, the net commission, and the KYC
 * documents. Every money figure comes from the ONE money engine (via
 * {@link priceBookings} / {@link computeInvoiceBreakdown}) so the ledger, the
 * approvals queue, and the detail can never disagree. ADMIN-only (route-enforced);
 * every mutation writes an AuditLog; KYC docs are exposed ONLY as short-lived
 * signed URLs — never the raw object.
 */
import { Prisma, type Booking, type BookingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { objectStorage } from "../../lib/storage.js";
import { env } from "../../config/env.js";
import { approvalStatusOf, computeInvoiceBreakdown } from "./erp.engine.js";
import { LEDGER_BOOKING_STATUSES, priceBookings, type BookingMoney } from "./erp.pricing.js";
import type {
  BookingApprovalStatus,
  BookingCommissionSummary,
  BookingKycBlock,
  BookingKycDocument,
  BookingLedgerEntry,
  BookingLedgerResponse,
  BookingLedgerTotals,
  BookingsLedgerExportQuery,
  BookingsLedgerQuery,
  CreateHistoricalBookingInput,
  ErpBookingDetailResponse,
  UpdateBookingInput,
} from "@roomadda/shared";

interface Actor {
  id: string;
}

/** Cap the export set so a full-table export can't run away (internal tool). */
const EXPORT_MAX_ROWS = 10_000;

const bookingNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });

// ---------------------------------------------------------------------------
// The booking columns + relations the ledger row / detail need.
// ---------------------------------------------------------------------------
export const ledgerInclude = {
  tenant: { select: { fullName: true } },
  listing: { select: { alias: true } },
  bookedByAgent: { select: { fullName: true } },
} satisfies Prisma.BookingInclude;

export type LedgerBookingRow = Prisma.BookingGetPayload<{ include: typeof ledgerInclude }>;

export const erpBookingsService = {
  /**
   * The bookings ledger (§15.3): every booking matching the filters, each priced
   * through the money engine (commission is non-null only for confirmed-paid
   * bookings). Totals cover the WHOLE filtered set (not just the page) so a
   * headline can never disagree with the rows; the commission totals sum only the
   * confirmed-paid rows, so they equal the commission ledger's totals for the
   * same filter. Cursor-paginated with an enforced max page size.
   */
  async ledger(query: BookingsLedgerQuery): Promise<BookingLedgerResponse> {
    const entries = await gatherEntries(query, EXPORT_MAX_ROWS);
    const totals = totalsOf(entries);
    const { items, nextCursor } = paginate(entries, query.cursor, query.limit);
    return { items, nextCursor, totals };
  },

  /** The same filtered+sorted rows as {@link ledger}, unpaginated, for export. */
  async exportRows(query: BookingsLedgerExportQuery): Promise<BookingLedgerEntry[]> {
    return gatherEntries(query, EXPORT_MAX_ROWS);
  },

  /**
   * One booking's full detail (§15.3): the customer, the invoice breakdown (money
   * engine), the net commission (ERP-1, null unless confirmed-paid), and the KYC
   * documents as SHORT-LIVED signed URLs (admin-only; the raw keys never leave the
   * server). Surfacing the documents is audited as a PII access.
   */
  async detail(actor: Actor, bookingId: string, ip?: string): Promise<ErpBookingDetailResponse> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            email: true,
            gender: true,
            occupationType: true,
            college: true,
            company: true,
          },
        },
        listing: { select: { id: true, alias: true, actualName: true, areaLabel: true, city: true } },
        bookedByAgent: { select: { id: true, fullName: true } },
      },
    });
    if (!booking) throw bookingNotFound();

    const invoice = computeInvoiceBreakdown({
      monthlyRentPaise: booking.monthlyRentPaise,
      depositPaise: booking.depositPaise,
      tokenAmountPaise: booking.tokenAmountPaise,
      moveIn: booking.moveInDate,
    });

    const commission = isCommissioned(booking.status)
      ? toCommissionSummary((await priceBookings([booking])).get(booking.id)!)
      : null;

    const kyc = await buildKycBlock(booking.tenantId);
    if (kyc && kyc.documents.length > 0) {
      // Auditing PII access: an admin viewed this customer's KYC documents.
      await writeAudit({
        actorId: actor.id,
        action: "erp.kyc.viewed",
        targetId: bookingId,
        ip,
        metadata: { userId: booking.tenantId, documentCount: kyc.documents.length },
      });
    }

    return {
      bookingId: booking.id,
      approval: approvalStatusOf(booking.status, booking.cancelledBy),
      bookingStatus: booking.status,
      historical: isHistorical(booking),
      createdAt: booking.createdAt.toISOString(),
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      moveInDate: booking.moveInDate?.toISOString() ?? null,
      customer: {
        userId: booking.tenant.id,
        fullName: booking.tenant.fullName,
        phone: booking.tenant.phone,
        email: booking.tenant.email,
        gender: booking.tenant.gender,
        occupationType: booking.tenant.occupationType,
        college: booking.tenant.college,
        company: booking.tenant.company,
      },
      listing: {
        listingId: booking.listing.id,
        alias: booking.listing.alias,
        actualName: booking.listing.actualName,
        areaLabel: booking.listing.areaLabel,
        city: booking.listing.city,
      },
      agent: booking.bookedByAgent
        ? {
            agentId: booking.bookedByAgent.id,
            agentName: booking.bookedByAgent.fullName,
            agentChannel: booking.agentChannel,
          }
        : null,
      invoice,
      commission,
      kyc,
    };
  },

  /**
   * Add a HISTORICAL booking (§15.3): a back-dated, already-CONFIRMED booking
   * assigned to an agent that flows into the dashboard / commission ledger / agent
   * performance exactly like a live one (those all read real Booking rows). The
   * bed is row-locked and the partial unique index is the backstop, so the
   * one-live-booking invariant holds. `confirmedAt` is set to the move-in date so
   * the booking lands in the right financial period. Audited.
   */
  async addHistorical(
    actor: Actor,
    input: CreateHistoricalBookingInput,
    ip?: string,
    now: Date = new Date(),
  ): Promise<BookingLedgerEntry> {
    const moveIn = new Date(input.moveInDate);
    if (moveIn.getTime() >= now.getTime()) {
      throw new AppError({
        statusCode: 422,
        code: "MOVE_IN_NOT_PAST",
        message: "A historical booking must have a past move-in date",
      });
    }

    const agent = await prisma.user.findUnique({ where: { id: input.agentId }, select: { role: true } });
    if (!agent || agent.role !== "AGENT") {
      throw new AppError({ statusCode: 422, code: "AGENT_NOT_FOUND", message: "No such agent" });
    }

    // Resolve (or create) the customer by phone — the agent/back-office vouches.
    const tenant = await prisma.user.findUnique({ where: { phone: input.tenantPhone }, select: { id: true } });
    const tenantId =
      tenant?.id ??
      (await prisma.user.create({
        data: { phone: input.tenantPhone, fullName: input.tenantName, role: "TENANT", isPhoneVerified: false },
        select: { id: true },
      })).id;

    let booking: Booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        // Row-lock the bed and confirm it is free (defence-in-depth alongside the
        // partial unique index) — the same invariant a live booking enforces.
        const beds = await tx.$queryRaw<Array<{ id: string; status: string; roomId: string }>>`
          SELECT id, status::text AS status, "roomId" FROM beds WHERE id = ${input.bedId}::uuid FOR UPDATE
        `;
        const bed = beds[0];
        if (!bed) throw new AppError({ statusCode: 404, code: "BED_NOT_FOUND", message: "Bed not found" });
        if (bed.status !== "AVAILABLE") {
          throw new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed is not available" });
        }
        const room = await tx.room.findUnique({ where: { id: bed.roomId }, select: { listingId: true } });
        if (!room) throw new AppError({ statusCode: 404, code: "ROOM_NOT_FOUND", message: "Room not found" });

        const created = await tx.booking.create({
          data: {
            bedId: bed.id,
            tenantId,
            listingId: room.listingId,
            status: "CONFIRMED",
            tokenAmountPaise: input.tokenAmountPaise,
            monthlyRentPaise: input.monthlyRentPaise,
            depositPaise: input.depositPaise,
            moveInDate: moveIn,
            // Confirmed as of move-in so it falls in the historical financial period.
            confirmedAt: moveIn,
            bookedByAgentId: input.agentId,
            agentChannel: input.agentChannel,
          },
        });
        await tx.bed.update({ where: { id: bed.id }, data: { status: "BOOKED" } });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed is not available" });
      }
      throw err;
    }

    await writeAudit({
      actorId: actor.id,
      action: "erp.booking.historical_created",
      targetId: booking.id,
      ip,
      metadata: {
        agentId: input.agentId,
        tenantId,
        bedId: input.bedId,
        moveInDate: moveIn.toISOString(),
        monthlyRentPaise: input.monthlyRentPaise,
        agentChannel: input.agentChannel,
      },
    });

    return entryFor(booking.id);
  },

  /**
   * Edit a booking's safe correction fields (§15.3, audited). Never the token
   * (payment truth) or the agent attribution (immutable once confirmed). Records
   * a before/after diff in the audit log.
   */
  async update(actor: Actor, bookingId: string, input: UpdateBookingInput, ip?: string): Promise<BookingLedgerEntry> {
    const existing = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, moveInDate: true, monthlyRentPaise: true, depositPaise: true, mealPlan: true },
    });
    if (!existing) throw bookingNotFound();

    const data: Prisma.BookingUpdateInput = {};
    const before: Record<string, string | number | null> = {};
    const after: Record<string, string | number | null> = {};
    if (input.moveInDate !== undefined) {
      const next = input.moveInDate === null ? null : new Date(input.moveInDate);
      data.moveInDate = next;
      before.moveInDate = existing.moveInDate?.toISOString() ?? null;
      after.moveInDate = next?.toISOString() ?? null;
    }
    if (input.monthlyRentPaise !== undefined) {
      data.monthlyRentPaise = input.monthlyRentPaise;
      before.monthlyRentPaise = existing.monthlyRentPaise;
      after.monthlyRentPaise = input.monthlyRentPaise;
    }
    if (input.depositPaise !== undefined) {
      data.depositPaise = input.depositPaise;
      before.depositPaise = existing.depositPaise;
      after.depositPaise = input.depositPaise;
    }
    if (input.mealPlan !== undefined) {
      data.mealPlan = input.mealPlan;
      before.mealPlan = existing.mealPlan;
      after.mealPlan = input.mealPlan;
    }

    await prisma.booking.update({ where: { id: bookingId }, data });
    await writeAudit({
      actorId: actor.id,
      action: "erp.booking.updated",
      targetId: bookingId,
      ip,
      metadata: { before, after },
    });

    return entryFor(bookingId);
  },

  /**
   * Delete a booking (§15.3, audited). Allowed ONLY when no money has touched it —
   * no Payment and no CashCollection — so a real, paid booking is never destroyed
   * (cancel that instead). The bed is freed in the same transaction; the
   * commission-ledger row (if any) cascades on delete.
   */
  async remove(actor: Actor, bookingId: string, ip?: string): Promise<{ deleted: true; bookingId: string }> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bedId: true,
        status: true,
        _count: { select: { cashCollections: true } },
        payment: { select: { id: true } },
      },
    });
    if (!booking) throw bookingNotFound();
    if (booking.payment || booking._count.cashCollections > 0) {
      throw new AppError({
        statusCode: 409,
        code: "BOOKING_HAS_PAYMENTS",
        message: "This booking has money attached and cannot be deleted — cancel it instead",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.delete({ where: { id: bookingId } });
      // Free the bed the deleted booking was holding (idempotent if already free).
      await tx.bed.update({ where: { id: booking.bedId }, data: { status: "AVAILABLE" } });
    });

    await writeAudit({
      actorId: actor.id,
      action: "erp.booking.deleted",
      targetId: bookingId,
      ip,
      metadata: { status: booking.status },
    });

    return { deleted: true, bookingId };
  },
};

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/** Which raw statuses carry commission (confirmed-paid). */
function isCommissioned(status: BookingStatus): boolean {
  return (LEDGER_BOOKING_STATUSES as readonly string[]).includes(status);
}

/** A booking is "historical" when it was confirmed BEFORE it was entered — the
 *  fingerprint of a back-dated admin entry (a live booking confirms after creation). */
function isHistorical(b: { confirmedAt: Date | null; createdAt: Date }): boolean {
  return b.confirmedAt !== null && b.confirmedAt.getTime() < b.createdAt.getTime();
}

/** Translate the approval filter to a Prisma booking WHERE fragment. */
function approvalWhere(approval: BookingApprovalStatus): Prisma.BookingWhereInput {
  switch (approval) {
    case "PENDING":
      return { status: { in: ["INITIATED", "PENDING_APPROVAL"] } };
    case "APPROVED":
      return { status: { in: ["TOKEN_PENDING", "CONFIRMED", "COMPLETED"] } };
    case "REJECTED":
      return { status: "CANCELLED", cancelledBy: { in: ["HOST", "SYSTEM"] } };
    case "CANCELLED":
      return {
        OR: [
          { status: "CANCELLED", cancelledBy: "TENANT" },
          { status: "CANCELLED", cancelledBy: null },
          { status: "EXPIRED" },
        ],
      };
  }
}

/** The orderBy for the chosen sort column (+ id tiebreaker for stable cursoring). */
function orderByOf(sort: BookingsLedgerQuery["sort"], order: BookingsLedgerQuery["order"]): Prisma.BookingOrderByWithRelationInput[] {
  const field = sort === "monthlyRent" ? "monthlyRentPaise" : sort;
  return [{ [field]: order } as Prisma.BookingOrderByWithRelationInput, { id: order }];
}

/** Shared filter → sorted, engine-priced entries (used by both list and export). */
async function gatherEntries(
  query: BookingsLedgerExportQuery | BookingsLedgerQuery,
  cap: number,
): Promise<BookingLedgerEntry[]> {
  const where: Prisma.BookingWhereInput = {
    ...(query.approval ? approvalWhere(query.approval) : {}),
    ...(query.listingId ? { listingId: query.listingId } : {}),
    ...(query.agentId ? { bookedByAgentId: query.agentId } : {}),
    ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    ...(query.q
      ? {
          OR: [
            { tenant: { fullName: { contains: query.q, mode: "insensitive" } } },
            { listing: { alias: { contains: query.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const rows = await prisma.booking.findMany({
    where,
    include: ledgerInclude,
    orderBy: orderByOf(query.sort, query.order),
    take: cap,
  });

  // Price only the confirmed-paid rows through the engine (one shared code path).
  const priced = await priceBookings(rows.filter((r) => isCommissioned(r.status)));
  return rows.map((r) => toLedgerEntry(r, priced.get(r.id)));
}

/** Load one row (post-mutation) and serialize it to an entry, pricing it through
 *  the engine when it is confirmed-paid (so a fresh entry carries its commission). */
async function entryFor(bookingId: string): Promise<BookingLedgerEntry> {
  const row = await prisma.booking.findUnique({ where: { id: bookingId }, include: ledgerInclude });
  if (!row) throw bookingNotFound();
  const money = isCommissioned(row.status) ? (await priceBookings([row])).get(row.id) : undefined;
  return toLedgerEntry(row, money);
}

/** Serialize one booking row into a ledger entry, folding in its money (if any). */
export function toLedgerEntry(row: LedgerBookingRow, money?: BookingMoney): BookingLedgerEntry {
  const commission = isCommissioned(row.status) && money ? toCommissionSummary(money) : null;
  return {
    bookingId: row.id,
    approval: approvalStatusOf(row.status, row.cancelledBy),
    bookingStatus: row.status,
    tenantId: row.tenantId,
    tenantName: row.tenant.fullName,
    listingId: row.listingId,
    listingAlias: row.listing.alias,
    agentId: row.bookedByAgentId,
    agentName: row.bookedByAgent?.fullName ?? null,
    agentChannel: row.agentChannel,
    monthlyRentPaise: row.monthlyRentPaise,
    tokenAmountPaise: row.tokenAmountPaise,
    depositPaise: row.depositPaise,
    moveInDate: row.moveInDate?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    historical: isHistorical(row),
    commission,
  };
}

function toCommissionSummary(money: BookingMoney): BookingCommissionSummary {
  return {
    commissionPaise: money.commissionPaise,
    paidToPgPaise: money.paidToPgPaise,
    collectedPaise: money.collectedPaise,
    netPaise: money.netPaise,
    status: money.settlementStatus,
  };
}

/** Roll up a set of entries. Commission totals sum ONLY the confirmed-paid rows,
 *  so they equal the commission ledger's totals for the same filter. */
function totalsOf(entries: BookingLedgerEntry[]): BookingLedgerTotals {
  const t: BookingLedgerTotals = {
    bookingCount: entries.length,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    cancelledCount: 0,
    commissionedBookingCount: 0,
    commissionPaise: 0,
    collectedPaise: 0,
    paidToPgPaise: 0,
    netPaise: 0,
  };
  for (const e of entries) {
    if (e.approval === "PENDING") t.pendingCount += 1;
    else if (e.approval === "APPROVED") t.approvedCount += 1;
    else if (e.approval === "REJECTED") t.rejectedCount += 1;
    else t.cancelledCount += 1;
    if (e.commission) {
      t.commissionedBookingCount += 1;
      t.commissionPaise += e.commission.commissionPaise;
      t.collectedPaise += e.commission.collectedPaise;
      t.paidToPgPaise += e.commission.paidToPgPaise;
      t.netPaise += e.commission.netPaise;
    }
  }
  return t;
}

/** In-memory cursor pagination over the sorted entries (cursor = bookingId). */
function paginate(
  entries: BookingLedgerEntry[],
  cursor: string | undefined,
  limit: number,
): { items: BookingLedgerEntry[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const idx = entries.findIndex((e) => e.bookingId === cursor);
    start = idx >= 0 ? idx + 1 : entries.length;
  }
  const slice = entries.slice(start, start + limit + 1);
  if (slice.length > limit) {
    const items = slice.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: last ? last.bookingId : null };
  }
  return { items: slice, nextCursor: null };
}

/**
 * Build the KYC block for the detail: the review status + the uploaded documents
 * as SHORT-LIVED signed GET URLs (the same admin-only presign the storage layer
 * issues; the raw object keys / numbers never leave the server). Returns null
 * when the customer has no KYC record at all.
 */
async function buildKycBlock(userId: string): Promise<BookingKycBlock | null> {
  const rec = await prisma.kycRecord.findUnique({ where: { userId } });
  if (!rec) return null;

  const slots: Array<{ slot: BookingKycDocument["slot"]; key: string | null }> = [
    { slot: "AADHAAR_FRONT", key: rec.aadhaarFrontKey },
    { slot: "AADHAAR_BACK", key: rec.aadhaarBackKey },
    { slot: "SUPPORTING", key: rec.supportingDocKey },
  ];
  const documents: BookingKycDocument[] = [];
  for (const s of slots) {
    if (!s.key) continue;
    documents.push({
      slot: s.slot,
      url: await objectStorage.presignDownload(s.key),
      expiresInSeconds: env.KYC_UPLOAD_URL_TTL_SECONDS,
    });
  }

  return {
    status: rec.status,
    submittedAt: rec.createdAt.toISOString(),
    reviewedAt: (rec.verifiedAt ?? rec.rejectedAt)?.toISOString() ?? null,
    rejectReason: rec.rejectReason ?? null,
    supportingDocType: rec.supportingDocType ?? null,
    documents,
  };
}
