import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { lineItemAmountPaise, quotationTotalPaise, sumLineItemsPaise } from "@roomadda/shared";
import type { Quotation as QuotationDto, QuotationLineInput } from "@roomadda/shared";
import type { AddRevisionInput, BuildQuotationInput, RespondQuotationInput } from "./corporate.schema.js";
import { assertSameCompany, type CompanyContext } from "./corporate.access.js";
import { toQuotation } from "./corporate.serializer.js";

/** Prisma include that carries the full revision history + its line items. */
const quotationInclude = { revisions: { include: { lineItems: true } } } satisfies Prisma.QuotationInclude;

const quotationNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "QUOTATION_NOT_FOUND", message: "Quotation not found" });

/** Price a set of input line items with the shared corporate money engine (integer
 *  paise). Returns the per-line amounts, the subtotal, and the total (+ tax). */
function priceLines(lines: QuotationLineInput[], taxPaise: number) {
  const priced = lines.map((l) => ({
    categoryId: l.categoryId ?? null,
    description: l.description,
    unitPricePaise: l.unitPricePaise,
    quantity: l.quantity,
    nights: l.nights,
    amountPaise: lineItemAmountPaise({ unitPricePaise: l.unitPricePaise, quantity: l.quantity, nights: l.nights }),
  }));
  const subtotalPaise = sumLineItemsPaise(priced);
  const totalPaise = quotationTotalPaise(subtotalPaise, taxPaise);
  return { priced, subtotalPaise, totalPaise };
}

async function loadQuotation(id: string, ctx?: CompanyContext): Promise<QuotationDto> {
  const q = await prisma.quotation.findUnique({ where: { id }, include: quotationInclude });
  if (!q) throw quotationNotFound();
  if (ctx) assertSameCompany(q.companyId, ctx);
  return toQuotation(q);
}

export const corporateQuotationService = {
  /**
   * ADMIN/CRM: build a quotation (revision 1) against an enquiry. Line prices are
   * server-owned (set by the CRM); amounts are engine-sourced integer paise. Sets
   * the enquiry to QUOTED. Audited.
   */
  async buildQuotation(actorId: string, input: BuildQuotationInput): Promise<QuotationDto> {
    const enquiry = await prisma.corporateEnquiry.findUnique({
      where: { id: input.enquiryId },
      select: { id: true, companyId: true, status: true },
    });
    if (!enquiry) throw new AppError({ statusCode: 404, code: "ENQUIRY_NOT_FOUND", message: "Enquiry not found" });
    if (enquiry.status === "CANCELLED") {
      throw new AppError({ statusCode: 409, code: "ENQUIRY_CANCELLED", message: "Cannot quote a cancelled enquiry" });
    }
    const { priced, subtotalPaise, totalPaise } = priceLines(input.lineItems, input.taxPaise);

    const created = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          companyId: enquiry.companyId,
          enquiryId: enquiry.id,
          createdById: actorId,
          status: "DRAFT",
          currentRevision: 1,
          validUntil: input.validUntil ?? null,
          revisions: {
            create: {
              revision: 1,
              createdById: actorId,
              subtotalPaise,
              taxPaise: input.taxPaise,
              totalPaise,
              notes: input.notes ?? null,
              lineItems: { create: priced },
            },
          },
        },
        include: quotationInclude,
      });
      await tx.corporateEnquiry.update({ where: { id: enquiry.id }, data: { status: "QUOTED" } });
      return q;
    });
    await writeAudit({ actorId, action: "corporate.quotation.built", targetId: created.id, metadata: { enquiryId: enquiry.id, totalPaise } });
    return toQuotation(created);
  },

  /**
   * ADMIN/CRM: append a NEW revision (a negotiation round). The prior revisions are
   * NEVER mutated — full history is preserved. Bumps `currentRevision` and re-sends
   * the offer (status → SENT). Not allowed once ACCEPTED/REJECTED/EXPIRED.
   */
  async addRevision(actorId: string, quotationId: string, input: AddRevisionInput): Promise<QuotationDto> {
    const q = await prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, status: true, currentRevision: true },
    });
    if (!q) throw quotationNotFound();
    if (["ACCEPTED", "REJECTED", "EXPIRED"].includes(q.status)) {
      throw new AppError({ statusCode: 409, code: "QUOTATION_CLOSED", message: "This quotation can no longer be revised" });
    }
    const { priced, subtotalPaise, totalPaise } = priceLines(input.lineItems, input.taxPaise);
    const nextRevision = q.currentRevision + 1;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.quotationRevision.create({
        data: {
          quotationId: q.id,
          revision: nextRevision,
          createdById: actorId,
          subtotalPaise,
          taxPaise: input.taxPaise,
          totalPaise,
          notes: input.notes ?? null,
          lineItems: { create: priced },
        },
      });
      return tx.quotation.update({
        where: { id: q.id },
        data: { currentRevision: nextRevision, status: "SENT", sentAt: new Date() },
        include: quotationInclude,
      });
    });
    await writeAudit({ actorId, action: "corporate.quotation.revised", targetId: q.id, metadata: { revision: nextRevision, totalPaise } });
    return toQuotation(updated);
  },

  /** ADMIN/CRM: send a DRAFT/NEGOTIATING quotation to the company (→ SENT). */
  async sendQuotation(actorId: string, quotationId: string): Promise<QuotationDto> {
    const q = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { status: true } });
    if (!q) throw quotationNotFound();
    if (!["DRAFT", "NEGOTIATING"].includes(q.status)) {
      throw new AppError({ statusCode: 409, code: "QUOTATION_NOT_SENDABLE", message: "Only a draft/negotiating quotation can be sent" });
    }
    await prisma.quotation.update({ where: { id: quotationId }, data: { status: "SENT", sentAt: new Date() } });
    await writeAudit({ actorId, action: "corporate.quotation.sent", targetId: quotationId, metadata: {} });
    return loadQuotation(quotationId);
  },

  /**
   * COMPANY: respond to a SENT quotation. ACCEPT → ACCEPTED (unlocks booking
   * conversion); REJECT → REJECTED; REQUEST_CHANGES → NEGOTIATING (admin then adds a
   * revision). Company-scoped. Audited.
   */
  async respond(userId: string, ctx: CompanyContext, quotationId: string, input: RespondQuotationInput): Promise<QuotationDto> {
    const q = await prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, companyId: true, status: true, validUntil: true },
    });
    if (!q) throw quotationNotFound();
    assertSameCompany(q.companyId, ctx);
    if (q.status !== "SENT") {
      throw new AppError({ statusCode: 409, code: "QUOTATION_NOT_ACTIONABLE", message: "This quotation is not awaiting a response" });
    }
    if (input.action === "ACCEPT" && q.validUntil && q.validUntil.getTime() < Date.now()) {
      throw new AppError({ statusCode: 409, code: "QUOTATION_EXPIRED", message: "This quotation has expired" });
    }

    const now = new Date();
    const data =
      input.action === "ACCEPT"
        ? { status: "ACCEPTED" as const, acceptedAt: now }
        : input.action === "REJECT"
          ? { status: "REJECTED" as const, rejectedAt: now }
          : { status: "NEGOTIATING" as const };
    await prisma.quotation.update({ where: { id: quotationId }, data });
    await writeAudit({
      actorId: userId,
      action: `corporate.quotation.${input.action.toLowerCase()}`,
      targetId: quotationId,
      metadata: { note: input.note ?? null },
    });
    return loadQuotation(quotationId, ctx);
  },

  async getById(id: string, ctx?: CompanyContext): Promise<QuotationDto> {
    return loadQuotation(id, ctx);
  },

  async listForCompany(ctx: CompanyContext, input: { cursor?: string; limit: number }): Promise<Page<QuotationDto>> {
    return listQuotations({ companyId: ctx.companyId, ...input });
  },

  /** ADMIN (CRM): quotations across all companies (optional company filter). */
  async listAll(input: { companyId?: string; cursor?: string; limit: number }): Promise<Page<QuotationDto>> {
    return listQuotations(input);
  },
};

async function listQuotations(input: { companyId?: string; cursor?: string; limit: number }): Promise<Page<QuotationDto>> {
  const rows = await prisma.quotation.findMany({
    where: input.companyId ? { companyId: input.companyId } : {},
    include: quotationInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const page = toPage(rows, input.limit);
  return { items: page.items.map(toQuotation), nextCursor: page.nextCursor };
}
