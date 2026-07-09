import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import type { CorporateEmployee } from "@roomadda/shared";
import type { CreateEmployeeInput } from "./corporate.schema.js";
import type { CompanyContext } from "./corporate.access.js";
import { toEmployee } from "./corporate.serializer.js";

/**
 * Employee directory — company-scoped. On create we JIT-link the consumer User with
 * the same phone (the single-identity merge rule); if none exists yet the link is
 * filled when that phone registers. An Employee row NEVER carries pricing/finance.
 */
export const corporateDirectoryService = {
  async createEmployee(actorId: string, ctx: CompanyContext, input: CreateEmployeeInput): Promise<CorporateEmployee> {
    // JIT identity link: attach an existing consumer User with this phone.
    const existingUser = await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    try {
      const employee = await prisma.employee.create({
        data: {
          companyId: ctx.companyId,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email ?? null,
          empCode: input.empCode ?? null,
          userId: existingUser?.id ?? null,
        },
      });
      await writeAudit({ actorId, action: "corporate.employee.created", targetId: employee.id, metadata: { companyId: ctx.companyId } });
      return toEmployee(employee);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "EMPLOYEE_EXISTS", message: "An employee with this phone already exists" });
      }
      throw err;
    }
  },

  async listEmployees(ctx: CompanyContext, input: { cursor?: string; limit: number }): Promise<Page<CorporateEmployee>> {
    const rows = await prisma.employee.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, input.limit);
    return { items: page.items.map(toEmployee), nextCursor: page.nextCursor };
  },
};
