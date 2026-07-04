import { Prisma } from "@prisma/client";
import type {
  AdminHostDetail,
  AdminHostListItem,
  AdminHostsQuery,
  FlagHostInput,
  ModerateUserInput,
} from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { invalidateFeaturedCache } from "../ad/ad.service.js";
import { moderateUser } from "./user-status.js";

/**
 * ADMIN host management (PRD §7.4). List/inspect hosts, moderate account standing
 * (suspend/ban/reinstate via the shared helper), take a listing down with a
 * mandatory reason, and flag a host for poor response. The host profile carries
 * the escalation history (escalated service requests across the host's listings)
 * + moderation flags. Every mutation is audited.
 */

type Actor = { id: string };

const hostNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "USER_NOT_FOUND", message: "Host not found" });

async function assertHost(id: string): Promise<{ id: string }> {
  const host = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!host || host.role !== "HOST") throw hostNotFound();
  return { id: host.id };
}

export const hostAdminService = {
  /** Host management list — standing + listing count + open escalations + flags. */
  async list(query: AdminHostsQuery): Promise<Page<AdminHostListItem>> {
    const where: Prisma.UserWhereInput = {
      role: "HOST",
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const rows = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, fullName: true, phone: true, email: true, status: true, statusReason: true, createdAt: true },
    });
    const page = toPage(rows, query.limit);
    const items = await Promise.all(page.items.map((h) => this.decorate(h)));
    return { items, nextCursor: page.nextCursor };
  },

  /** Attach the per-host rollup counts (listings, open escalations, flags). */
  async decorate(h: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    status: AdminHostListItem["status"];
    statusReason: string | null;
    createdAt: Date;
  }): Promise<AdminHostListItem> {
    const [listingCount, openEscalations, flagCount] = await Promise.all([
      prisma.pgListing.count({ where: { hostId: h.id } }),
      prisma.serviceRequest.count({
        where: { escalated: true, status: { not: "RESOLVED" }, listing: { hostId: h.id } },
      }),
      prisma.hostFlag.count({ where: { hostId: h.id } }),
    ]);
    return {
      id: h.id,
      fullName: h.fullName,
      phone: h.phone,
      email: h.email,
      status: h.status,
      statusReason: h.statusReason,
      listingCount,
      openEscalations,
      flagCount,
      createdAt: h.createdAt.toISOString(),
    };
  },

  /** Full host profile: standing + escalation history + moderation flags. */
  async getDetail(id: string): Promise<AdminHostDetail> {
    const host = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, fullName: true, phone: true, email: true, status: true, statusReason: true, statusUpdatedAt: true, createdAt: true },
    });
    if (!host || host.role !== "HOST") throw hostNotFound();

    const [base, escalations, flags] = await Promise.all([
      this.decorate(host),
      prisma.serviceRequest.findMany({
        where: { escalated: true, listing: { hostId: id } },
        orderBy: [{ escalatedAt: "desc" }, { createdAt: "desc" }],
        take: 50,
        include: { listing: { select: { id: true, alias: true } } },
      }),
      prisma.hostFlag.findMany({ where: { hostId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);

    return {
      ...base,
      statusUpdatedAt: host.statusUpdatedAt?.toISOString() ?? null,
      escalations: escalations.map((e) => ({
        id: e.id,
        ticketNumber: e.ticketNumber,
        category: e.category,
        priority: e.priority,
        status: e.status,
        escalatedAt: e.escalatedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
        listing: { id: e.listing.id, alias: e.listing.alias },
      })),
      flags: flags.map((f) => ({
        id: f.id,
        reason: f.reason,
        serviceRequestId: f.serviceRequestId,
        createdAt: f.createdAt.toISOString(),
      })),
    };
  },

  /** Suspend / ban / reinstate the host (reason mandatory for suspend/ban). */
  async moderate(actor: Actor, id: string, input: ModerateUserInput, ip?: string): Promise<AdminHostDetail> {
    await moderateUser(actor, id, "HOST", input, ip);
    return this.getDetail(id);
  },

  /** Flag a host for poor response (append-only; feeds escalation history). */
  async flag(actor: Actor, id: string, input: FlagHostInput, ip?: string): Promise<AdminHostDetail> {
    await assertHost(id);
    if (input.serviceRequestId) {
      const sr = await prisma.serviceRequest.findFirst({
        where: { id: input.serviceRequestId, listing: { hostId: id } },
        select: { id: true },
      });
      if (!sr) {
        throw new AppError({ statusCode: 422, code: "SERVICE_REQUEST_NOT_FOUND", message: "Service request does not belong to this host" });
      }
    }
    await prisma.hostFlag.create({
      data: { hostId: id, reason: input.reason, serviceRequestId: input.serviceRequestId ?? null, createdById: actor.id },
    });
    await writeAudit({
      actorId: actor.id,
      action: "host.flagged",
      targetId: id,
      ip,
      metadata: { reason: input.reason, serviceRequestId: input.serviceRequestId ?? null },
    });
    return this.getDetail(id);
  },

  /** Take a listing down with a MANDATORY reason (SUSPENDED). Audited. */
  async takedownListing(actor: Actor, listingId: string, reason: string, ip?: string): Promise<{ id: string; status: string }> {
    const listing = await prisma.pgListing.findUnique({ where: { id: listingId }, select: { id: true, status: true, hostId: true } });
    if (!listing) throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
    const updated = await prisma.pgListing.update({ where: { id: listingId }, data: { status: "SUSPENDED" } });
    await writeAudit({
      actorId: actor.id,
      action: "listing.taken_down",
      targetId: listingId,
      ip,
      metadata: { hostId: listing.hostId, before: { status: listing.status }, after: { status: "SUSPENDED" }, reason },
    });
    await invalidateFeaturedCache();
    return { id: updated.id, status: updated.status };
  },
};
