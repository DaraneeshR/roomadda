import { Prisma } from "@prisma/client";
import type { ServiceRequestAdminDetail } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { toAdminItem } from "../service-request/service-request.serializer.js";

/**
 * Admin oversight of tenant service requests (PRD §7.9). The admin can read the
 * full ticket, resolve it on the host's behalf, and contact the host WITHOUT
 * exposing the host's phone (the message is delivered as an admin note into the
 * host's queue). Flagging a host lives in the host-admin service. Every state
 * change is audited (see /CLAUDE.md); nothing here ever mutates money.
 */

type Actor = { id: string };

const adminDetailInclude = {
  tenant: { select: { id: true, fullName: true, phone: true } },
  listing: { select: { id: true, alias: true, city: true, host: { select: { id: true, fullName: true } } } },
  comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } },
} satisfies Prisma.ServiceRequestInclude;

type AdminDetailRow = Prisma.ServiceRequestGetPayload<{ include: typeof adminDetailInclude }>;

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "SERVICE_REQUEST_NOT_FOUND", message: "Service request not found" });

/** Best-effort host/tenant notification on an admin action (real push wired later). */
function notify(target: "host" | "tenant", userId: string, requestId: string, event: string): void {
  logger.info({ target, userId, requestId, event }, "service-request admin notification (stub)");
}

function toDetail(r: AdminDetailRow): ServiceRequestAdminDetail {
  // Feed the shared item serializer a listing WITHOUT the host (item never carries it).
  const item = toAdminItem({
    ...r,
    tenant: r.tenant,
    listing: { id: r.listing.id, alias: r.listing.alias, city: r.listing.city },
  });
  return {
    ...item,
    host: { id: r.listing.host.id, fullName: r.listing.host.fullName },
    comments: r.comments.map((c) => ({
      id: c.id,
      authorRole: c.authorRole,
      authorName: c.author.fullName,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

async function load(id: string): Promise<AdminDetailRow> {
  const req = await prisma.serviceRequest.findUnique({ where: { id }, include: adminDetailInclude });
  if (!req) throw notFound();
  return req;
}

export const serviceRequestAdminService = {
  /** Full ticket for the admin (who/where + host + comment thread). */
  async getDetail(id: string): Promise<ServiceRequestAdminDetail> {
    return toDetail(await load(id));
  },

  /** Resolve a request on the host's behalf (mandatory reason, audited). */
  async resolveOnBehalf(actor: Actor, id: string, reason: string, ip?: string): Promise<ServiceRequestAdminDetail> {
    const req = await load(id);
    if (req.status === "RESOLVED") {
      throw new AppError({ statusCode: 409, code: "ALREADY_RESOLVED", message: "Request is already resolved" });
    }
    await prisma.$transaction([
      prisma.serviceRequest.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } }),
      prisma.serviceRequestComment.create({
        data: { requestId: id, authorId: actor.id, authorRole: "ADMIN", body: `Resolved by admin: ${reason}` },
      }),
    ]);
    await writeAudit({
      actorId: actor.id,
      action: "service_request.resolved_by_admin",
      targetId: id,
      ip,
      metadata: { before: { status: req.status }, after: { status: "RESOLVED" }, reason },
    });
    notify("tenant", req.tenantId, id, "resolved_by_admin");
    notify("host", req.listing.host.id, id, "resolved_by_admin");
    return toDetail(await load(id));
  },

  /**
   * Contact the host about a request from the admin panel — WITHOUT sharing the
   * host's phone. The message lands as an admin note in the host's service queue
   * (an ADMIN comment) and pings the host. Audited.
   */
  async contactHost(actor: Actor, id: string, message: string, ip?: string): Promise<ServiceRequestAdminDetail> {
    const req = await load(id);
    await prisma.serviceRequestComment.create({
      data: { requestId: id, authorId: actor.id, authorRole: "ADMIN", body: message },
    });
    await writeAudit({
      actorId: actor.id,
      action: "service_request.host_contacted",
      targetId: id,
      ip,
      metadata: { hostId: req.listing.host.id },
    });
    notify("host", req.listing.host.id, id, "admin_contacted");
    return toDetail(await load(id));
  },
};
