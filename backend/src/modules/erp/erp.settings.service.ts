/**
 * ERP-5 Settings & Users (§15.7). The singleton org settings (company details,
 * active financial year, operating-mode flags) plus the back-office team roster
 * and the server-side "add team login" (§15.8). Every write is ADMIN-only
 * (route-enforced) and audited; a team login is created with a scrypt password
 * hash (never the raw password) and a forced first-login password change. The
 * active `financialYear` here is the default period the CA compliance pack and the
 * finance screens use when no explicit FY is passed.
 */
import { Prisma, type OrgSettings as OrgSettingsRow, type UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import type {
  AddTeamMemberInput,
  OrgSettings,
  TeamListResponse,
  TeamMember,
  UpdateOrgSettingsInput,
} from "@roomadda/shared";

interface Actor {
  id: string;
}

/** The only role a team login may hold today (back-office = ADMIN). */
const ASSIGNABLE_TEAM_ROLES: UserRole[] = ["ADMIN"];

export const erpSettingsService = {
  /** The current org settings (creating the singleton row on first access). */
  async getSettings(): Promise<OrgSettings> {
    return toSettingsDto(await getOrCreateSettings());
  },

  /**
   * Resolve the ACTIVE financial year for the CA pack / finance defaults: the
   * settings value if set, else the FY of `now` (delegated to the caller via
   * `fallback`). Read-only; no row is written here beyond the get-or-create.
   */
  async activeFinancialYear(fallback: number): Promise<number> {
    const settings = await getOrCreateSettings();
    return settings.financialYear ?? fallback;
  },

  /** Update the singleton settings (§15.7). Audited with a before/after diff. */
  async updateSettings(actor: Actor, input: UpdateOrgSettingsInput, ip?: string): Promise<OrgSettings> {
    const existing = await getOrCreateSettings();

    // Build the update + a before/after diff for the audit, field by field. Only
    // provided keys are touched; `updatedById` records who made the change.
    const data: Prisma.OrgSettingsUncheckedUpdateInput = { updatedById: actor.id };
    type JsonScalar = string | number | boolean | null;
    const before: Record<string, JsonScalar> = {};
    const after: Record<string, JsonScalar> = {};
    const set = <K extends keyof UpdateOrgSettingsInput>(key: K) => {
      const next = input[key];
      if (next === undefined) return;
      (data as Record<string, unknown>)[key] = next;
      before[key] = ((existing as Record<string, unknown>)[key] ?? null) as JsonScalar;
      after[key] = (next ?? null) as JsonScalar;
    };
    (
      [
        "legalName",
        "displayName",
        "gstin",
        "pan",
        "addressLine",
        "city",
        "state",
        "pincode",
        "contactEmail",
        "contactPhone",
        "financialYear",
        "onlineBookingsEnabled",
        "walkInBookingsEnabled",
        "maintenanceMode",
      ] as const
    ).forEach(set);

    const updated = await prisma.orgSettings.update({ where: { id: existing.id }, data });

    await writeAudit({
      actorId: actor.id,
      action: "erp.settings.updated",
      targetId: existing.id,
      ip,
      metadata: { before, after },
    });
    return toSettingsDto(updated);
  },

  /** The back-office team roster (every ADMIN account), newest first. */
  async listTeam(): Promise<TeamListResponse> {
    const rows = await prisma.user.findMany({
      where: { role: "ADMIN" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });
    return { items: rows.map(toTeamMember) };
  },

  /**
   * Add a back-office team login (§15.7/§15.8, server-side). Creates a real ADMIN
   * user identified by email with a scrypt-hashed temp password and a forced
   * first-login change (`mustChangePassword`). The raw temp password is NEVER
   * stored or logged. A duplicate email is a typed 409.
   */
  async addTeamMember(actor: Actor, input: AddTeamMemberInput, ip?: string): Promise<TeamMember> {
    const passwordHash = await hashPassword(input.tempPassword);
    try {
      const user = await prisma.user.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          role: input.role,
          passwordHash,
          mustChangePassword: true,
          isPhoneVerified: false,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          mustChangePassword: true,
          createdAt: true,
        },
      });

      await writeAudit({
        actorId: actor.id,
        action: "erp.team.created",
        targetId: user.id,
        ip,
        // Email + role only — never the password (see /CLAUDE.md secrets rule).
        metadata: { email: input.email, role: input.role },
      });
      return toTeamMember(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({
          statusCode: 409,
          code: "EMAIL_TAKEN",
          message: "A user with this email already exists",
        });
      }
      throw err;
    }
  },
};

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/** Get the singleton settings row, creating it (with schema defaults) on first use. */
async function getOrCreateSettings(): Promise<OrgSettingsRow> {
  const existing = await prisma.orgSettings.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.orgSettings.create({ data: {} });
}

function toSettingsDto(row: OrgSettingsRow): OrgSettings {
  return {
    legalName: row.legalName,
    displayName: row.displayName,
    gstin: row.gstin,
    pan: row.pan,
    addressLine: row.addressLine,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    financialYear: row.financialYear,
    operatingModes: {
      onlineBookingsEnabled: row.onlineBookingsEnabled,
      walkInBookingsEnabled: row.walkInBookingsEnabled,
      maintenanceMode: row.maintenanceMode,
    },
    availableRoles: ASSIGNABLE_TEAM_ROLES,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTeamMember(row: {
  id: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  status: TeamMember["status"];
  mustChangePassword: boolean;
  createdAt: Date;
}): TeamMember {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt.toISOString(),
  };
}
