/**
 * ERP-3 Invoice Center (§15.6/§15.7). Two invoices come off ONE booking —
 * CUSTOMER (for the tenant) and COMMISSION (for the PG owner) — and EVERY money
 * figure is sourced from the ERP-1 money engine (via {@link priceBookings} /
 * {@link computeInvoiceBreakdown} and the pure composers in erp.engine.ts), never
 * recomputed here. The Invoice row persists ONLY the non-derivable manual figures
 * (maintenance / electricity) and the amount-paid override; the engine lines are
 * recomposed on every read, so an edit can never corrupt an engine figure. PDFs
 * reuse the receipt-PDF approach; delivery goes over WhatsApp behind the same
 * env-gated stub/real seam as SOS/broadcasts. ADMIN-only (route-enforced); every
 * send / mark-sent / edit writes an AuditLog.
 */
import { Prisma, type InvoiceType as PrismaInvoiceType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { invoiceDeliverer, type InvoiceCampaign } from "../../lib/invoice-delivery.js";
import { buildInvoicePdf } from "./erp.invoices.pdf.js";
import {
  composeCommissionInvoice,
  composeCustomerInvoice,
  computeInvoiceBreakdown,
  type ComposedInvoice,
} from "./erp.engine.js";
import { LEDGER_BOOKING_STATUSES, priceBookings, type BookingMoney } from "./erp.pricing.js";
import type {
  Invoice,
  InvoiceListEntry,
  InvoiceListQuery,
  InvoiceListResponse,
  InvoiceSendResult,
  InvoiceType,
  UpdateInvoiceInput,
} from "@roomadda/shared";

interface Actor {
  id: string;
}

/** Cap the list fetch so a full-table scan can't run away (internal tool). */
const LIST_MAX_ROWS = 5_000;

// ---------------------------------------------------------------------------
// The booking columns + relations an invoice needs (recipient + engine inputs).
// ---------------------------------------------------------------------------
const invoiceInclude = {
  tenant: { select: { fullName: true, phone: true } },
  listing: { select: { alias: true, host: { select: { fullName: true, phone: true } } } },
} satisfies Prisma.BookingInclude;

type InvoiceBookingRow = Prisma.BookingGetPayload<{ include: typeof invoiceInclude }>;

/** The non-derivable figures the Invoice row persists in `lineItems` (JSON). The
 *  engine lines (deposit/rent/commission/...) are NEVER stored here. */
interface ManualFigures {
  maintenancePaise?: number;
  electricityPaise?: number;
  /** Admin override of the amount-paid; when absent the engine-collected amount is used. */
  paidOverridePaise?: number | null;
}

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });

export const erpInvoicesService = {
  /**
   * The Invoice Center list (§15.7): one row per confirmed-paid booking for the
   * chosen invoice type — recipient name + number, total, balance, and sent
   * status. Every figure is recomposed from the money engine (overlaying any
   * persisted manual/override); an existing Invoice row supplies only its status /
   * sentAt. Cursor-paginated with an enforced max page size.
   */
  async list(query: InvoiceListQuery): Promise<InvoiceListResponse> {
    const rows = await prisma.booking.findMany({
      where: { status: { in: [...LEDGER_BOOKING_STATUSES] } },
      include: invoiceInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIST_MAX_ROWS,
    });

    const [money, existing] = await Promise.all([
      priceBookings(rows.map((r) => ({ id: r.id, monthlyRentPaise: r.monthlyRentPaise }))),
      loadExisting(rows.map((r) => r.id), query.type),
    ]);

    let entries: InvoiceListEntry[] = rows.map((row) => {
      const composed = composeFor(query.type, row, money.get(row.id)!, manualOf(existing.get(row.id)?.lineItems));
      const recipient = recipientOf(query.type, row);
      const persisted = existing.get(row.id);
      return {
        bookingId: row.id,
        type: query.type,
        recipientName: recipient.name,
        recipientPhone: recipient.phone,
        listingAlias: row.listing.alias,
        totalPaise: composed.totalPaise,
        balancePaise: composed.balancePaise,
        status: persisted?.status ?? "DRAFT",
        sentAt: persisted?.sentAt?.toISOString() ?? null,
      };
    });

    if (query.q) {
      const needle = query.q.toLowerCase();
      entries = entries.filter(
        (e) => e.recipientName.toLowerCase().includes(needle) || e.listingAlias.toLowerCase().includes(needle),
      );
    }
    if (query.status) entries = entries.filter((e) => e.status === query.status);

    const { items, nextCursor } = paginate(entries, query.cursor, query.limit);
    return { items, nextCursor };
  },

  /** Review one invoice (§15.7): the full line items + total / amount-paid /
   *  balance, every engine line recomputed live from ERP-1. */
  async review(bookingId: string, type: InvoiceType): Promise<Invoice> {
    const ctx = await loadCtx(bookingId, type);
    return serialize(type, ctx);
  },

  /**
   * Edit a CUSTOMER invoice's NON-DERIVABLE figures (§15.7): the maintenance /
   * electricity line items and/or the amount-paid override. The engine-owned
   * deposit / pro-rata rent are untouched — they always come from ERP-1 — so the
   * balance updates without any engine figure changing. Upserts a DRAFT row
   * (keeps an existing SENT status), audited.
   */
  async update(actor: Actor, bookingId: string, type: InvoiceType, input: UpdateInvoiceInput, ip?: string): Promise<Invoice> {
    if (type !== "CUSTOMER") {
      throw new AppError({
        statusCode: 422,
        code: "INVOICE_NOT_EDITABLE",
        message: "A commission invoice's figures are engine-owned and cannot be edited",
      });
    }
    const ctx = await loadCtx(bookingId, type);
    const merged: ManualFigures = {
      ...manualOf(ctx.existing?.lineItems),
      ...(input.maintenancePaise !== undefined ? { maintenancePaise: input.maintenancePaise } : {}),
      ...(input.electricityPaise !== undefined ? { electricityPaise: input.electricityPaise } : {}),
      ...(input.paidPaise !== undefined ? { paidOverridePaise: input.paidPaise } : {}),
    };
    const composed = composeFor(type, ctx.row, ctx.money, merged);
    await persist(bookingId, type, merged, composed, {}); // status/sentAt unchanged
    await writeAudit({
      actorId: actor.id,
      action: "erp.invoice.updated",
      targetId: bookingId,
      ip,
      metadata: { type, ...input },
    });
    return serialize(type, await loadCtx(bookingId, type));
  },

  /** The rendered invoice PDF bytes (§15.7 "Generate PDF") — reused by both the
   *  download route and the send flow, so what's shown is what's delivered. */
  async pdf(bookingId: string, type: InvoiceType): Promise<Uint8Array> {
    const ctx = await loadCtx(bookingId, type);
    return renderPdf(type, ctx);
  },

  /**
   * Send ONE invoice (§15.7): persist it SENT + `sentAt`, then deliver the PDF
   * over WhatsApp via the stubbed seam (best-effort — the sent state is recorded
   * first). Audited. `deliver=false` is the "mark sent for existing customers
   * without resending" path.
   */
  async send(actor: Actor, bookingId: string, type: InvoiceType, deliver: boolean, ip?: string): Promise<Invoice> {
    const ctx = await loadCtx(bookingId, type);
    const manual = manualOf(ctx.existing?.lineItems);
    const composed = composeFor(type, ctx.row, ctx.money, manual);
    await persist(bookingId, type, manual, composed, {
      status: "SENT",
      sentAt: new Date(),
      sentById: actor.id,
    });

    if (deliver) await deliverInvoice(type, ctx, composed);

    await writeAudit({
      actorId: actor.id,
      action: deliver ? "erp.invoice.sent" : "erp.invoice.marked_sent",
      targetId: bookingId,
      ip,
      metadata: { type, campaign: campaignOf(type), delivered: deliver },
    });
    return serialize(type, await loadCtx(bookingId, type));
  },

  /**
   * Bulk-send invoices of one type (§15.7). Only confirmed-paid bookings in the
   * list are eligible (others silently skipped). Persists all SENT rows in ONE
   * transaction (multi-row mutation, /CLAUDE.md), then delivers each best-effort
   * outside the transaction, and writes ONE audit record.
   */
  async sendBulk(actor: Actor, type: InvoiceType, bookingIds: string[], ip?: string): Promise<InvoiceSendResult> {
    const rows = await prisma.booking.findMany({
      where: { id: { in: bookingIds }, status: { in: [...LEDGER_BOOKING_STATUSES] } },
      include: invoiceInclude,
    });
    const money = await priceBookings(rows.map((r) => ({ id: r.id, monthlyRentPaise: r.monthlyRentPaise })));
    const existing = await loadExisting(rows.map((r) => r.id), type);

    const prepared = rows.map((row) => {
      const manual = manualOf(existing.get(row.id)?.lineItems);
      const composed = composeFor(type, row, money.get(row.id)!, manual);
      return { row, manual, composed };
    });

    const at = new Date();
    if (prepared.length > 0) {
      await prisma.$transaction(
        prepared.map((p) =>
          upsertArgs(p.row.id, type, p.manual, p.composed, { status: "SENT", sentAt: at, sentById: actor.id }),
        ),
      );
      // Deliver outside the transaction (never hold a tx across a network call).
      for (const p of prepared) await deliverInvoice(type, { row: p.row }, p.composed);
    }

    const sentIds = prepared.map((p) => p.row.id);
    await writeAudit({
      actorId: actor.id,
      action: "erp.invoice.sent_bulk",
      ip,
      metadata: { type, campaign: campaignOf(type), requested: bookingIds.length, sent: sentIds.length, bookingIds: sentIds },
    });
    return { sent: sentIds.length, bookingIds: sentIds, delivered: true };
  },
};

// ---------------------------------------------------------------------------
// Internal — context loading, composition, persistence, delivery, pagination.
// ---------------------------------------------------------------------------

interface ExistingInvoice {
  lineItems: Prisma.JsonValue;
  status: "DRAFT" | "SENT";
  sentAt: Date | null;
}

interface BookingCtx {
  row: InvoiceBookingRow;
  money: BookingMoney;
  existing: ExistingInvoice | null;
}

/** Load one booking + its engine money + the existing invoice of `type` (if any),
 *  batched. The engine money + persisted manual/override drive every figure. */
async function loadCtx(bookingId: string, type: InvoiceType): Promise<BookingCtx> {
  const row = await prisma.booking.findUnique({ where: { id: bookingId }, include: invoiceInclude });
  if (!row) throw notFound();
  assertInvoiceable(row.status);
  const [money, existing] = await Promise.all([
    priceBookings([{ id: row.id, monthlyRentPaise: row.monthlyRentPaise }]).then((m) => m.get(row.id)),
    loadExisting([row.id], type).then((m) => m.get(row.id) ?? null),
  ]);
  if (!money) throw notFound();
  return { row, money, existing };
}

/** A booking must be confirmed-paid before it carries real money to invoice. */
function assertInvoiceable(status: InvoiceBookingRow["status"]): void {
  if (!(LEDGER_BOOKING_STATUSES as readonly string[]).includes(status)) {
    throw new AppError({
      statusCode: 409,
      code: "BOOKING_NOT_INVOICEABLE",
      message: "Only a confirmed-paid booking can be invoiced",
    });
  }
}

/** Compose the invoice for a booking from the engine + any manual figures. */
function composeFor(type: InvoiceType, row: InvoiceBookingRow, money: BookingMoney, manual: ManualFigures): ComposedInvoice {
  if (type === "CUSTOMER") {
    const breakdown = computeInvoiceBreakdown({
      monthlyRentPaise: row.monthlyRentPaise,
      depositPaise: row.depositPaise,
      tokenAmountPaise: row.tokenAmountPaise,
      moveIn: row.moveInDate,
    });
    return composeCustomerInvoice({
      breakdown,
      maintenancePaise: manual.maintenancePaise ?? 0,
      electricityPaise: manual.electricityPaise ?? 0,
      // Amount paid: the admin override if set, else the engine-collected amount.
      paidPaise: manual.paidOverridePaise ?? money.collectedPaise,
    });
  }
  return composeCommissionInvoice({
    commissionPaise: money.commissionPaise,
    paidToPgPaise: money.paidToPgPaise,
    collectedPaise: money.collectedPaise,
    netPaise: money.netPaise,
    settlementStatus: money.settlementStatus,
  });
}

/** The recipient of an invoice: tenant (customer) or PG owner (commission). */
function recipientOf(type: InvoiceType, row: InvoiceBookingRow): { name: string; phone: string } {
  return type === "CUSTOMER"
    ? { name: row.tenant.fullName, phone: row.tenant.phone! } // tenant/host are phone-OTP users
    : { name: row.listing.host.fullName, phone: row.listing.host.phone! };
}

function campaignOf(type: InvoiceType): InvoiceCampaign {
  return type === "CUSTOMER" ? "customer" : "pgowner";
}

/** Serialize a loaded ctx into the wire Invoice (engine lines recomputed live). */
function serialize(type: InvoiceType, ctx: BookingCtx): Invoice {
  const composed = composeFor(type, ctx.row, ctx.money, manualOf(ctx.existing?.lineItems));
  const recipient = recipientOf(type, ctx.row);
  return {
    bookingId: ctx.row.id,
    type,
    recipient,
    listingAlias: ctx.row.listing.alias,
    lineItems: composed.lineItems,
    totalPaise: composed.totalPaise,
    paidPaise: composed.paidPaise,
    balancePaise: composed.balancePaise,
    status: ctx.existing?.status ?? "DRAFT",
    sentAt: ctx.existing?.sentAt?.toISOString() ?? null,
  };
}

async function renderPdf(type: InvoiceType, ctx: BookingCtx): Promise<Uint8Array> {
  const invoice = serialize(type, ctx);
  return buildInvoicePdf({ invoice, moveInDate: ctx.row.moveInDate, generatedAt: new Date() });
}

/** Deliver a composed invoice PDF over the WhatsApp seam (best-effort). */
async function deliverInvoice(
  type: InvoiceType,
  ctx: { row: InvoiceBookingRow },
  composed: ComposedInvoice,
): Promise<void> {
  const recipient = recipientOf(type, ctx.row);
  const invoice: Invoice = {
    bookingId: ctx.row.id,
    type,
    recipient,
    listingAlias: ctx.row.listing.alias,
    lineItems: composed.lineItems,
    totalPaise: composed.totalPaise,
    paidPaise: composed.paidPaise,
    balancePaise: composed.balancePaise,
    status: "SENT",
    sentAt: new Date().toISOString(),
  };
  const pdf = await buildInvoicePdf({ invoice, moveInDate: ctx.row.moveInDate, generatedAt: new Date() });
  await invoiceDeliverer.sendInvoice({
    toPhone: recipient.phone,
    recipientName: recipient.name,
    campaign: campaignOf(type),
    invoiceType: type,
    bookingId: ctx.row.id,
    filename: `roomadda-invoice-${type.toLowerCase()}-${ctx.row.id}.pdf`,
    pdf,
    caption:
      type === "CUSTOMER"
        ? `Your RoomAdda invoice for ${ctx.row.listing.alias}`
        : `Commission statement for ${ctx.row.listing.alias}`,
  });
}

/** Prisma upsert args for one invoice's snapshot + status (shared by single/bulk). */
function upsertArgs(
  bookingId: string,
  type: InvoiceType,
  manual: ManualFigures,
  composed: ComposedInvoice,
  statusPatch: { status?: "SENT"; sentAt?: Date; sentById?: string },
) {
  const lineItems = manualToJson(manual);
  const snapshot = { totalPaise: composed.totalPaise, paidPaise: composed.paidPaise, balancePaise: composed.balancePaise };
  return prisma.invoice.upsert({
    where: { bookingId_type: { bookingId, type: type as PrismaInvoiceType } },
    create: { bookingId, type: type as PrismaInvoiceType, lineItems, ...snapshot, ...statusPatch },
    update: { lineItems, ...snapshot, ...statusPatch },
  });
}

async function persist(
  bookingId: string,
  type: InvoiceType,
  manual: ManualFigures,
  composed: ComposedInvoice,
  statusPatch: { status?: "SENT"; sentAt?: Date; sentById?: string },
): Promise<void> {
  await upsertArgs(bookingId, type, manual, composed, statusPatch);
}

/** Load existing Invoice rows for a set of bookings + type, keyed by bookingId. */
async function loadExisting(
  bookingIds: string[],
  type: InvoiceType,
): Promise<Map<string, { lineItems: Prisma.JsonValue; status: "DRAFT" | "SENT"; sentAt: Date | null }>> {
  if (bookingIds.length === 0) return new Map();
  const rows = await prisma.invoice.findMany({
    where: { bookingId: { in: bookingIds }, type: type as PrismaInvoiceType },
    select: { bookingId: true, lineItems: true, status: true, sentAt: true },
  });
  return new Map(rows.map((r) => [r.bookingId, { lineItems: r.lineItems, status: r.status, sentAt: r.sentAt }]));
}

/** Parse the persisted manual figures defensively from the JSON column. */
function manualOf(json: Prisma.JsonValue | null | undefined): ManualFigures {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
  return {
    maintenancePaise: num(o.maintenancePaise),
    electricityPaise: num(o.electricityPaise),
    paidOverridePaise: num(o.paidOverridePaise) ?? null,
  };
}

/** Serialize the manual figures for the JSON column, omitting absent values (no
 *  `undefined`/`null` keys) so the stored shape stays clean. */
function manualToJson(m: ManualFigures): Prisma.InputJsonValue {
  const o: Record<string, number> = {};
  if (typeof m.maintenancePaise === "number") o.maintenancePaise = m.maintenancePaise;
  if (typeof m.electricityPaise === "number") o.electricityPaise = m.electricityPaise;
  if (typeof m.paidOverridePaise === "number") o.paidOverridePaise = m.paidOverridePaise;
  return o;
}

/** In-memory cursor pagination over the sorted entries (cursor = bookingId). */
function paginate(
  entries: InvoiceListEntry[],
  cursor: string | undefined,
  limit: number,
): { items: InvoiceListEntry[]; nextCursor: string | null } {
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
