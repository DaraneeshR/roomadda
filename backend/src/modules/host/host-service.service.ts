import { Prisma, type ServiceRequestStatus } from "@prisma/client";
import type { HostServiceRequest } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { toPage, type Page } from "../../lib/pagination.js";

/**
 * Host service queue. A host sees the maintenance requests across THEIR listings,
 * can acknowledge / add a tenant-visible note / mark resolved (each notifies the
 * tenant), and can NEVER delete (no delete path exists). Auto-escalated tickets
 * surface via the `escalated` flag. The host sees only the tenant's display name
 * and room — NO KYC. Average resolution time is computed for the dashboard.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;

const hostRequestInclude = {
  tenant: { select: { fullName: true } }, // name ONLY — no kyc, no phone
  booking: { select: { bed: { select: { room: { select: { name: true } } } } } },
  comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } },
} satisfies Prisma.ServiceRequestInclude;

export type HostServiceRow = Prisma.ServiceRequestGetPayload<{ include: typeof hostRequestInclude }>;

export function toHostServiceRequest(r: HostServiceRow): HostServiceRequest {
  return {
    id: r.id,
    ticketNumber: r.ticketNumber,
    category: r.category,
    description: r.description,
    priority: r.priority,
    status: r.status,
    photoCount: r.photoRefs.length,
    escalated: r.escalated,
    rating: r.rating ?? null,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    tenantName: r.tenant.fullName,
    roomName: r.booking.bed.room.name ?? null,
    escalatedAt: r.escalatedAt?.toISOString() ?? null,
    comments: r.comments.map((c) => ({
      id: c.id,
      authorRole: c.authorRole,
      authorName: c.author.fullName,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

/** Scope a query to the host's own listings (ADMIN sees all). */
function scopeWhere(actor: { id: string; role: string }): Prisma.ServiceRequestWhereInput {
  return actor.role === "ADMIN" ? {} : { listing: { hostId: actor.id } };
}

/** Best-effort tenant notification on a status change (real push wired later). */
function notifyTenant(requestId: string, tenantId: string, event: string): void {
  logger.info({ requestId, tenantId, event }, "service-request tenant notification (stub)");
}

/** A foreign/absent request is 404 (existence never leaked across hosts). */
const notFound = () =>
  new AppError({ statusCode: 404, code: "SERVICE_REQUEST_NOT_FOUND", message: "Service request not found" });

async function loadOwned(id: string, actor: { id: string; role: string }): Promise<HostServiceRow> {
  const req = await prisma.serviceRequest.findUnique({
    where: { id },
    include: { ...hostRequestInclude, listing: { select: { hostId: true } } },
  });
  const isOwnerHost = actor.role === "HOST" && req?.listing.hostId === actor.id;
  if (!req || (actor.role !== "ADMIN" && !isOwnerHost)) throw notFound();
  return req;
}

export const hostServiceService = {
  /** The host's service queue (escalated first, then newest), with rollup stats. */
  async listQueue(
    actor: { id: string; role: string },
    query: { status?: ServiceRequestStatus; cursor?: string; limit: number },
  ): Promise<Page<HostServiceRow> & { stats: HostServiceQueueStats }> {
    const where: Prisma.ServiceRequestWhereInput = {
      ...scopeWhere(actor),
      ...(query.status ? { status: query.status } : {}),
    };
    const rows = await prisma.serviceRequest.findMany({
      where,
      include: hostRequestInclude,
      orderBy: [{ escalated: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    const stats = await this.queueStats(actor);
    return { ...page, stats };
  },

  /** Open/escalated counts + mean SUBMITTED→RESOLVED time (hours) for the scope. */
  async queueStats(actor: { id: string; role: string }): Promise<HostServiceQueueStats> {
    const scope = scopeWhere(actor);
    const [openCount, escalatedCount, resolved] = await Promise.all([
      prisma.serviceRequest.count({ where: { ...scope, status: { not: "RESOLVED" } } }),
      prisma.serviceRequest.count({ where: { ...scope, escalated: true, status: { not: "RESOLVED" } } }),
      prisma.serviceRequest.findMany({
        where: { ...scope, status: "RESOLVED", resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      }),
    ]);
    let avgResolutionHours: number | null = null;
    if (resolved.length > 0) {
      const totalMs = resolved.reduce((sum, r) => sum + ((r.resolvedAt?.getTime() ?? 0) - r.createdAt.getTime()), 0);
      avgResolutionHours = Math.round((totalMs / resolved.length / ONE_HOUR_MS) * 10) / 10;
    }
    return { openCount, escalatedCount, avgResolutionHours };
  },

  getDetail(id: string, actor: { id: string; role: string }): Promise<HostServiceRow> {
    return loadOwned(id, actor);
  },

  /** Acknowledge a SUBMITTED request (host has seen it). Notifies the tenant. */
  async acknowledge(id: string, actor: { id: string; role: string }): Promise<HostServiceRow> {
    const req = await loadOwned(id, actor);
    if (req.status !== "SUBMITTED") {
      throw new AppError({ statusCode: 409, code: "INVALID_TRANSITION", message: "Only a submitted request can be acknowledged" });
    }
    await prisma.serviceRequest.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() } });
    notifyTenant(id, req.tenantId, "acknowledged");
    return loadOwned(id, actor);
  },

  /** Add a tenant-visible note (a HOST comment). Notifies the tenant. */
  async addNote(id: string, actor: { id: string; role: "HOST" | "ADMIN" }, note: string): Promise<HostServiceRow> {
    const req = await loadOwned(id, actor);
    await prisma.serviceRequestComment.create({
      data: { requestId: id, authorId: actor.id, authorRole: actor.role, body: note },
    });
    notifyTenant(id, req.tenantId, "note_added");
    return loadOwned(id, actor);
  },

  /** Mark a request RESOLVED. Notifies the tenant (who can then rate it). */
  async resolve(id: string, actor: { id: string; role: string }): Promise<HostServiceRow> {
    const req = await loadOwned(id, actor);
    if (req.status === "RESOLVED") {
      throw new AppError({ statusCode: 409, code: "ALREADY_RESOLVED", message: "Request is already resolved" });
    }
    await prisma.serviceRequest.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    notifyTenant(id, req.tenantId, "resolved");
    return loadOwned(id, actor);
  },
};

export interface HostServiceQueueStats {
  openCount: number;
  escalatedCount: number;
  avgResolutionHours: number | null;
}
