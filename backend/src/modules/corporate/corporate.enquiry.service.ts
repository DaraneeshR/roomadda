import type { EnquiryStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import type { CorporateEnquiry } from "@roomadda/shared";
import type { CreateEnquiryInput } from "./corporate.schema.js";
import { assertSameCompany, type CompanyContext } from "./corporate.access.js";
import { toEnquiry } from "./corporate.serializer.js";

const enquiryNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "ENQUIRY_NOT_FOUND", message: "Enquiry not found" });

export const corporateEnquiryService = {
  /** COMPANY: raise an enquiry for the caller's own company. */
  async createEnquiry(userId: string, ctx: CompanyContext, input: CreateEnquiryInput): Promise<CorporateEnquiry> {
    const enquiry = await prisma.corporateEnquiry.create({
      data: {
        companyId: ctx.companyId,
        createdById: userId,
        city: input.city,
        area: input.area ?? null,
        propertyType: input.propertyType,
        headcount: input.headcount,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        notes: input.notes ?? null,
      },
    });
    await writeAudit({ actorId: userId, action: "corporate.enquiry.created", targetId: enquiry.id, metadata: { companyId: ctx.companyId } });
    return toEnquiry(enquiry);
  },

  /** COMPANY: the caller's own-company enquiries, newest first. */
  async listForCompany(ctx: CompanyContext, input: { cursor?: string; limit: number }): Promise<Page<CorporateEnquiry>> {
    const rows = await prisma.corporateEnquiry.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, input.limit);
    return { items: page.items.map(toEnquiry), nextCursor: page.nextCursor };
  },

  /** ADMIN: the sales-pipeline queue across ALL companies (optional status filter). */
  async listPipeline(input: { status?: EnquiryStatus; cursor?: string; limit: number }): Promise<Page<CorporateEnquiry>> {
    const rows = await prisma.corporateEnquiry.findMany({
      where: input.status ? { status: input.status } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, input.limit);
    return { items: page.items.map(toEnquiry), nextCursor: page.nextCursor };
  },

  /** Read one enquiry. When `ctx` is passed (company caller) it is company-scoped. */
  async getById(id: string, ctx?: CompanyContext): Promise<CorporateEnquiry> {
    const enquiry = await prisma.corporateEnquiry.findUnique({ where: { id } });
    if (!enquiry) throw enquiryNotFound();
    if (ctx) assertSameCompany(enquiry.companyId, ctx);
    return toEnquiry(enquiry);
  },
};
