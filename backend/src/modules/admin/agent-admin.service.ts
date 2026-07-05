import { Prisma } from "@prisma/client";
import type {
  AdminAgentListItem,
  AdminAgentVisit,
  AdminAgentsQuery,
  AssignVisitInput,
  ModerateUserInput,
  UpdateAgentTerritoryInput,
} from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { moderateUser } from "./user-status.js";

/**
 * ADMIN agent management (PRD §7.5). List agents, retune an agent's territory
 * (assignedCity — the §9.1 zone key), assign a property-inspection visit, and
 * moderate account standing. Agent creation lives in adminService.createAgent.
 * A visit can only be assigned to an agent whose zone matches the listing's city
 * (the zone invariant); every mutation is audited.
 */

type Actor = { id: string };

const agentNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "USER_NOT_FOUND", message: "Agent not found" });

async function loadAgent(id: string): Promise<{ id: string; assignedCity: string | null }> {
  const agent = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, assignedCity: true } });
  if (!agent || agent.role !== "AGENT") throw agentNotFound();
  return { id: agent.id, assignedCity: agent.assignedCity };
}

export const agentAdminService = {
  /** Agent management list — standing, zone, and open (scheduled) visit count. */
  async list(query: AdminAgentsQuery): Promise<Page<AdminAgentListItem>> {
    const where: Prisma.UserWhereInput = {
      role: "AGENT",
      ...(query.status ? { status: query.status } : {}),
      ...(query.city ? { assignedCity: { equals: query.city, mode: "insensitive" } } : {}),
    };
    const rows = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, fullName: true, phone: true, email: true, assignedCity: true, status: true, statusReason: true, createdAt: true },
    });
    const page = toPage(rows, query.limit);
    const items = await Promise.all(
      page.items.map(async (a) => ({
        id: a.id,
        fullName: a.fullName,
        phone: a.phone!, // an AGENT is always created with a phone
        email: a.email,
        assignedCity: a.assignedCity,
        status: a.status,
        statusReason: a.statusReason,
        openVisits: await prisma.agentVisit.count({ where: { agentId: a.id, status: "SCHEDULED" } }),
        createdAt: a.createdAt.toISOString(),
      })),
    );
    return { items, nextCursor: page.nextCursor };
  },

  /** Move an agent to a new territory (zone). Audited. */
  async updateTerritory(actor: Actor, id: string, input: UpdateAgentTerritoryInput, ip?: string): Promise<AdminAgentListItem> {
    const agent = await loadAgent(id);
    await prisma.user.update({ where: { id }, data: { assignedCity: input.assignedCity } });
    await writeAudit({
      actorId: actor.id,
      action: "agent.territory_changed",
      targetId: id,
      ip,
      metadata: { from: agent.assignedCity, to: input.assignedCity },
    });
    return this.getOne(id);
  },

  async getOne(id: string): Promise<AdminAgentListItem> {
    const a = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, fullName: true, phone: true, email: true, assignedCity: true, status: true, statusReason: true, createdAt: true },
    });
    if (!a || a.role !== "AGENT") throw agentNotFound();
    return {
      id: a.id,
      fullName: a.fullName,
      phone: a.phone!, // an AGENT is always created with a phone
      email: a.email,
      assignedCity: a.assignedCity,
      status: a.status,
      statusReason: a.statusReason,
      openVisits: await prisma.agentVisit.count({ where: { agentId: a.id, status: "SCHEDULED" } }),
      createdAt: a.createdAt.toISOString(),
    };
  },

  /** Suspend / ban / reinstate an agent. */
  async moderate(actor: Actor, id: string, input: ModerateUserInput, ip?: string): Promise<AdminAgentListItem> {
    await moderateUser(actor, id, "AGENT", input, ip);
    return this.getOne(id);
  },

  /**
   * Assign an inspection visit to an agent. The agent must be scoped to the
   * listing's city (the §9.1 zone invariant), else a typed 422. Audited.
   */
  async assignVisit(actor: Actor, input: AssignVisitInput, ip?: string): Promise<AdminAgentVisit> {
    const [agent, listing] = await Promise.all([
      loadAgent(input.agentId),
      prisma.pgListing.findUnique({ where: { id: input.listingId }, select: { id: true, city: true } }),
    ]);
    if (!listing) throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
    if (!agent.assignedCity || agent.assignedCity.toLowerCase() !== listing.city.toLowerCase()) {
      throw new AppError({
        statusCode: 422,
        code: "AGENT_OUT_OF_ZONE",
        message: "Agent's territory does not cover this listing's city",
      });
    }
    const visit = await prisma.agentVisit.create({
      data: { listingId: input.listingId, agentId: input.agentId, scheduledAt: input.scheduledAt, status: "SCHEDULED" },
    });
    await writeAudit({
      actorId: actor.id,
      action: "agent.visit_assigned",
      targetId: visit.id,
      ip,
      metadata: { agentId: input.agentId, listingId: input.listingId, scheduledAt: input.scheduledAt.toISOString() },
    });
    return {
      id: visit.id,
      listingId: visit.listingId,
      agentId: visit.agentId,
      status: visit.status,
      scheduledAt: visit.scheduledAt.toISOString(),
      createdAt: visit.createdAt.toISOString(),
    };
  },
};
