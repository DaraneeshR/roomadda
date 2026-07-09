import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { invoiceBalancePaise } from "@roomadda/shared";
import type {
  CorporateCompany,
  CorporateFinanceSummary,
  CorporateOverview,
} from "@roomadda/shared";
import type { CreateCompanyInput } from "./corporate.schema.js";
import type { CompanyContext } from "./corporate.access.js";
import { toCompany } from "./corporate.serializer.js";

const companyNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "COMPANY_NOT_FOUND", message: "Company not found" });

/** Sum the outstanding (unpaid) balance across a set of invoices. Engine-derived. */
function outstandingOf(invoices: { totalPaise: number; paidPaise: number; status: string }[]): number {
  return invoices
    .filter((i) => i.status !== "PAID")
    .reduce((acc, i) => acc + invoiceBalancePaise(i.totalPaise, i.paidPaise), 0);
}

export const corporateCompanyService = {
  // ===== ADMIN: company directory ==========================================

  /** Create a company account. Optionally attaches a first ADMIN HR seat + an
   *  account manager. Audited. */
  async createCompany(actorId: string, input: CreateCompanyInput): Promise<CorporateCompany> {
    if (input.accountManagerId) {
      const mgr = await prisma.user.findUnique({ where: { id: input.accountManagerId }, select: { role: true } });
      if (!mgr || (mgr.role !== "ADMIN" && mgr.role !== "AGENT")) {
        throw new AppError({ statusCode: 400, code: "INVALID_ACCOUNT_MANAGER", message: "Account manager must be an admin or agent" });
      }
    }
    const company = await prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          name: input.name,
          gstin: input.gstin ?? null,
          billingAddress: input.billingAddress ?? null,
          billingEmail: input.billingEmail ?? null,
          billingMode: input.billingMode,
          creditDays: input.creditDays,
          accountManagerId: input.accountManagerId ?? null,
        },
      });
      if (input.adminUserId) {
        await tx.companyUser.create({ data: { companyId: c.id, userId: input.adminUserId, role: "ADMIN" } });
      }
      return c;
    });
    await writeAudit({ actorId, action: "corporate.company.created", targetId: company.id, metadata: { name: company.name } });
    return toCompany(company);
  },

  async listCompanies(input: { cursor?: string; limit: number }): Promise<Page<CorporateCompany>> {
    const rows = await prisma.company.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, input.limit);
    return { items: page.items.map(toCompany), nextCursor: page.nextCursor };
  },

  async assignAccountManager(actorId: string, companyId: string, managerId: string | null): Promise<CorporateCompany> {
    if (managerId) {
      const mgr = await prisma.user.findUnique({ where: { id: managerId }, select: { role: true } });
      if (!mgr || (mgr.role !== "ADMIN" && mgr.role !== "AGENT")) {
        throw new AppError({ statusCode: 400, code: "INVALID_ACCOUNT_MANAGER", message: "Account manager must be an admin or agent" });
      }
    }
    const existing = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!existing) throw companyNotFound();
    const company = await prisma.company.update({ where: { id: companyId }, data: { accountManagerId: managerId } });
    await writeAudit({ actorId, action: "corporate.company.account_manager_assigned", targetId: companyId, metadata: { managerId } });
    return toCompany(company);
  },

  /** Admin receivables roll-up across ALL companies (engine-sourced). */
  async financeSummary(): Promise<CorporateFinanceSummary> {
    const now = new Date();
    const invoices = await prisma.corporateInvoice.findMany({
      select: { totalPaise: true, paidPaise: true, status: true, dueDate: true },
    });
    const invoicedPaise = invoices.reduce((a, i) => a + i.totalPaise, 0);
    const collectedPaise = invoices.reduce((a, i) => a + i.paidPaise, 0);
    const outstandingPaise = outstandingOf(invoices);
    const overdueCount = invoices.filter(
      (i) => i.status !== "PAID" && i.dueDate !== null && i.dueDate.getTime() < now.getTime(),
    ).length;
    return { invoicedPaise, collectedPaise, outstandingPaise, overdueCount };
  },

  // ===== COMPANY (HR): dashboard overview ==================================

  /** The HR dashboard roll-up for the caller's OWN company (scoped). */
  async overview(ctx: CompanyContext): Promise<CorporateOverview> {
    const now = new Date();
    const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
    if (!company) throw companyNotFound();

    const [bookingsTotal, employeesTotal, activeStays, invoices] = await Promise.all([
      prisma.corporateBooking.count({ where: { companyId: ctx.companyId } }),
      prisma.employee.count({ where: { companyId: ctx.companyId } }),
      prisma.hotelReservation.count({
        where: {
          corporateBooking: { companyId: ctx.companyId },
          status: "CONFIRMED",
          checkIn: { lte: now },
          checkOut: { gt: now },
        },
      }),
      prisma.corporateInvoice.findMany({
        where: { companyId: ctx.companyId },
        select: { totalPaise: true, paidPaise: true, status: true },
      }),
    ]);
    const spendPaise = invoices.reduce((a, i) => a + i.paidPaise, 0);
    const outstandingPaise = outstandingOf(invoices);

    return {
      company: toCompany(company),
      bookingsTotal,
      activeStays,
      employeesTotal,
      spendPaise,
      outstandingPaise,
    };
  },
};
