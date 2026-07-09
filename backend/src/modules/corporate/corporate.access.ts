import type { CompanyUserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

/**
 * Company scoping — the HARD boundary that makes a CompanyUser see ONLY their own
 * company's data (/CLAUDE.md default-deny). Every company-scoped route resolves the
 * caller's seat here first, then every read/write is filtered by `companyId`; a
 * cross-company id is reported as 404 (existence never leaked), never 403-with-detail.
 */

export interface CompanyContext {
  companyId: string;
  role: CompanyUserRole;
}

const notCompanyUser = (): AppError =>
  new AppError({ statusCode: 403, code: "NOT_A_COMPANY_USER", message: "You are not a member of a company workspace" });

const notCompanyAdmin = (): AppError =>
  new AppError({ statusCode: 403, code: "COMPANY_ADMIN_REQUIRED", message: "This action requires a company admin seat" });

/**
 * Resolve the caller's company seat. MVP assumes one seat per login (a user belongs
 * to a single company workspace); `findFirst` picks it. 403 if the caller has none.
 */
export async function resolveCompanyContext(userId: string): Promise<CompanyContext> {
  const seat = await prisma.companyUser.findFirst({
    where: { userId },
    select: { companyId: true, role: true },
  });
  if (!seat) throw notCompanyUser();
  return { companyId: seat.companyId, role: seat.role };
}

/** As above, but also require the ADMIN role within the company (HR admin actions). */
export async function resolveCompanyAdminContext(userId: string): Promise<CompanyContext> {
  const ctx = await resolveCompanyContext(userId);
  if (ctx.role !== "ADMIN") throw notCompanyAdmin();
  return ctx;
}

/**
 * Assert an entity belongs to the caller's company. A mismatch is a 404 (an entity in
 * another company must be indistinguishable from one that does not exist).
 */
export function assertSameCompany(entityCompanyId: string, ctx: CompanyContext): void {
  if (entityCompanyId !== ctx.companyId) {
    throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Not found" });
  }
}
