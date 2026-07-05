import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { notifyKycDecision } from "../../lib/notify.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { invalidateFeaturedCache } from "../ad/ad.service.js";
import { assertListingPublishable } from "../listing/listing.service.js";
import { serviceRequestService } from "../service-request/service-request.service.js";
import { toAdminItem } from "../service-request/service-request.serializer.js";
import { chatService } from "../chat/chat.service.js";
import type {
  adminInspectionsQuerySchema,
  adminServiceRequestsQuerySchema,
  bookingSearchSchema,
  cashQuerySchema,
  createAgentSchema,
  kycQuerySchema,
  listingReviewQuerySchema,
  paymentSearchSchema,
} from "./admin.schema.js";
import type { AgentSummary } from "@roomadda/shared";
import type { z } from "zod";

type Actor = { id: string };
type Paged = { cursor?: string; limit: number };

const kycNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "KYC_NOT_FOUND", message: "KYC record not found" });
const listingNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });

export const adminService = {
  // ---- KYC review --------------------------------------------------------
  async listKyc(query: z.infer<typeof kycQuerySchema>): Promise<Page<unknown>> {
    const rows = await prisma.kycRecord.findMany({
      where: { status: query.status },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { user: { select: { id: true, phone: true, fullName: true, role: true } } },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((k) => ({
        id: k.id,
        status: k.status,
        docType: k.docType,
        user: k.user,
        createdAt: k.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },

  async approveKyc(actor: Actor, kycId: string, ip?: string): Promise<{ id: string; status: string }> {
    const kyc = await prisma.kycRecord.findUnique({ where: { id: kycId } });
    if (!kyc) throw kycNotFound();
    const updated = await prisma.kycRecord.update({
      where: { id: kycId },
      data: { status: "VERIFIED", verifiedAt: new Date(), rejectedAt: null, rejectReason: null },
    });
    await writeAudit({
      actorId: actor.id,
      action: "kyc.approved",
      targetId: kycId,
      ip,
      metadata: { userId: kyc.userId, before: { status: kyc.status }, after: { status: "VERIFIED" } },
    });
    await notifyKycDecision({ userId: kyc.userId, status: "VERIFIED" });
    return { id: updated.id, status: updated.status };
  },

  async rejectKyc(actor: Actor, kycId: string, reason: string, ip?: string): Promise<{ id: string; status: string }> {
    const kyc = await prisma.kycRecord.findUnique({ where: { id: kycId } });
    if (!kyc) throw kycNotFound();
    const updated = await prisma.kycRecord.update({
      where: { id: kycId },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectReason: reason, verifiedAt: null },
    });
    await writeAudit({
      actorId: actor.id,
      action: "kyc.rejected",
      targetId: kycId,
      ip,
      metadata: { userId: kyc.userId, before: { status: kyc.status }, after: { status: "REJECTED" }, reason },
    });
    await notifyKycDecision({ userId: kyc.userId, status: "REJECTED", reason });
    return { id: updated.id, status: updated.status };
  },

  // ---- Listing review / publish -----------------------------------------
  async listListings(query: z.infer<typeof listingReviewQuerySchema>): Promise<Page<unknown>> {
    const rows = await prisma.pgListing.findMany({
      where: { status: query.status },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, alias: true, actualName: true, city: true, status: true, hostId: true, createdAt: true },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  },

  async publishListing(actor: Actor, id: string, ip?: string): Promise<{ id: string; status: string }> {
    // PRD §9.2 go-live gate: throws a typed 422 (with { failed: [...] }) unless
    // photos >= 5, the host's KYC is VERIFIED, and a priced room exists. A
    // missing listing surfaces as 404 from here. `gate` is the passing snapshot.
    const gate = await assertListingPublishable(id);
    const updated = await prisma.pgListing.update({ where: { id }, data: { status: "PUBLISHED" } });
    await writeAudit({
      actorId: actor.id,
      action: "listing.published",
      targetId: id,
      ip,
      metadata: {
        before: { status: gate.status },
        after: { status: "PUBLISHED" },
        gate: { photos: gate.photoCount, kyc: gate.kycStatus, hasPricedRoom: gate.hasPricedRoom },
      },
    });
    await invalidateFeaturedCache();
    return { id: updated.id, status: updated.status };
  },

  async suspendListing(actor: Actor, id: string, ip?: string): Promise<{ id: string; status: string }> {
    const listing = await prisma.pgListing.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!listing) throw listingNotFound();
    const updated = await prisma.pgListing.update({ where: { id }, data: { status: "SUSPENDED" } });
    await writeAudit({
      actorId: actor.id,
      action: "listing.suspended",
      targetId: id,
      ip,
      metadata: { before: { status: listing.status }, after: { status: "SUSPENDED" } },
    });
    await invalidateFeaturedCache();
    return { id: updated.id, status: updated.status };
  },

  // ---- Cash reconciliation ----------------------------------------------
  /** Per-agent cash-in-hand = sum of COLLECTED (not yet RECONCILED). */
  async cashInHand(query: Paged): Promise<Page<unknown>> {
    const grouped = await prisma.cashCollection.groupBy({
      by: ["agentId"],
      where: { status: "COLLECTED", ...(query.cursor ? { agentId: { gt: query.cursor } } : {}) },
      _sum: { amountPaise: true },
      orderBy: { agentId: "asc" },
      take: query.limit + 1,
    });
    const page = toPage(
      grouped.map((g) => ({ id: g.agentId, agentId: g.agentId, cashInHandPaise: g._sum.amountPaise ?? 0 })),
      query.limit,
    );
    const agents = await prisma.user.findMany({
      where: { id: { in: page.items.map((i) => i.agentId) } },
      select: { id: true, fullName: true, phone: true },
    });
    const byId = new Map(agents.map((a) => [a.id, a]));
    return {
      items: page.items.map((i) => ({
        agentId: i.agentId,
        agentName: byId.get(i.agentId)?.fullName ?? null,
        agentPhone: byId.get(i.agentId)?.phone ?? null,
        cashInHandPaise: i.cashInHandPaise,
      })),
      nextCursor: page.nextCursor,
    };
  },

  /** Queue of collected-but-not-reconciled cash. Reconcile via PATCH .../reconcile. */
  async reconciliationQueue(query: z.infer<typeof cashQuerySchema>): Promise<Page<unknown>> {
    const rows = await prisma.cashCollection.findMany({
      where: { status: "COLLECTED" },
      orderBy: [{ collectedAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        agent: { select: { id: true, fullName: true, phone: true } },
        booking: { select: { id: true, listingId: true, tenantId: true } },
      },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((cc) => ({
        id: cc.id,
        amountPaise: cc.amountPaise,
        status: cc.status,
        collectedAt: cc.collectedAt?.toISOString() ?? null,
        agent: cc.agent,
        booking: cc.booking,
      })),
      nextCursor: page.nextCursor,
    };
  },

  // ---- Search ------------------------------------------------------------
  async searchBookings(query: z.infer<typeof bookingSearchSchema>): Promise<Page<unknown>> {
    const where: Prisma.BookingWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.listingId) where.listingId = query.listingId;
    const rows = await prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((b) => ({
        id: b.id,
        status: b.status,
        tenantId: b.tenantId,
        listingId: b.listingId,
        bedId: b.bedId,
        tokenAmountPaise: b.tokenAmountPaise,
        confirmedAt: b.confirmedAt?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },

  async searchPayments(query: z.infer<typeof paymentSearchSchema>): Promise<Page<unknown>> {
    const where: Prisma.PaymentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.bookingId) where.bookingId = query.bookingId;
    const rows = await prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((p) => ({
        id: p.id,
        bookingId: p.bookingId,
        amountPaise: p.amountPaise,
        status: p.status,
        method: p.method,
        razorpayOrderId: p.razorpayOrderId,
        createdAt: p.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },

  // ---- Maintenance / service requests ------------------------------------
  /** Oversight list of tenant service requests (escalated first). Read-only. */
  async listServiceRequests(query: z.infer<typeof adminServiceRequestsQuerySchema>): Promise<Page<unknown>> {
    const page = await serviceRequestService.listForAdmin(query);
    return { items: page.items.map(toAdminItem), nextCursor: page.nextCursor };
  },

  // ---- Chat moderation ---------------------------------------------------
  /** Reported chat messages, newest first (the audit mirror powers moderation). */
  async listChatReports(query: Paged): Promise<Page<unknown>> {
    return chatService.listReportsForAdmin(query);
  },

  // ---- Agents (ADMIN-created, zone-scoped; no self-register) -------------
  /**
   * Create a zone-scoped AGENT. Agents are ONLY ever created here (never
   * self-registered) and are confined to `assignedCity` — the §9.1 zone-access
   * invariant. A duplicate phone/email is a typed 409.
   */
  async createAgent(actor: Actor, input: z.infer<typeof createAgentSchema>, ip?: string): Promise<AgentSummary> {
    try {
      const agent = await prisma.user.create({
        data: {
          fullName: input.fullName,
          phone: input.phone,
          email: input.email ?? null,
          role: "AGENT",
          assignedCity: input.assignedCity,
          isPhoneVerified: false,
        },
      });
      await writeAudit({
        actorId: actor.id,
        action: "agent.created",
        targetId: agent.id,
        ip,
        metadata: { assignedCity: input.assignedCity },
      });
      return {
        id: agent.id,
        fullName: agent.fullName,
        phone: agent.phone!, // an AGENT is always created with a phone
        assignedCity: agent.assignedCity,
        role: agent.role,
        createdAt: agent.createdAt.toISOString(),
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]).join(",") : "";
        throw new AppError({
          statusCode: 409,
          code: target.includes("email") ? "EMAIL_TAKEN" : "PHONE_TAKEN",
          message: "An account with this phone or email already exists",
        });
      }
      throw err;
    }
  },

  // ---- Property inspection review queue ----------------------------------
  /** Agent inspections awaiting review (SUBMITTED by default), oldest first. */
  async listInspections(query: z.infer<typeof adminInspectionsQuerySchema>): Promise<Page<unknown>> {
    const rows = await prisma.propertyInspection.findMany({
      where: { status: query.status },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        agent: { select: { id: true, fullName: true, assignedCity: true } },
        visit: { select: { id: true, scheduledAt: true } },
        listing: { select: { id: true, alias: true, city: true } },
        _count: { select: { photos: true } },
      },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((i) => ({
        id: i.id,
        status: i.status,
        recommendation: i.recommendation,
        roomCountListed: i.roomCountListed,
        roomCountActual: i.roomCountActual,
        photoCount: i._count.photos,
        agent: i.agent,
        visit: { id: i.visit.id, scheduledAt: i.visit.scheduledAt.toISOString() },
        listing: i.listing,
        submittedAt: i.submittedAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  },
};
